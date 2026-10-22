/**
 * MathMover 桌面主进程。
 *
 * 三条命，按依赖顺序拉起：
 *   1. daemon（随包 Node 24 跑预编译的 cli.mjs）—— WebSocket 8787 + HTTP 8788
 *      WS 端口固定：渲染进程的默认连接地址是构建期常量（NEXT_PUBLIC_*），
 *      端口动态化要另开一条运行时配置通道，MVP 先不做；HTTP 端口可动态。
 *   2. Next standalone（同一个 Node 24）—— 端口动态挑空闲的
 *   3. BrowserWindow 加载 http://127.0.0.1:<nextPort>/dashboard
 *
 * 所有子进程日志写到 <dataDir>/logs/，崩溃时错误框里给路径。
 */
const { app, BrowserWindow, shell, dialog, clipboard, Menu, ipcMain, nativeTheme } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { createSystemTray } = require('./system-tray.cjs');
const { restoreMacPath } = require('./platform.cjs');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const WS_PORT_START = 8787;
const HTTP_PORT_START = 8788;
const NEXT_PORT_START = 3123;

// 打包后 extraResources 落在 resources/；开发时（electron .）用 desktop/build/
const BUILD_ROOT = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'build');
const NODE_BIN = path.join(BUILD_ROOT, 'node', IS_WIN ? 'node.exe' : 'node');
const NEXT_DIR = path.join(BUILD_ROOT, 'next');
const ASSET_ROOT = path.join(BUILD_ROOT, 'app');
const OPENCODE_BIN = path.join(BUILD_ROOT, 'bin', IS_WIN ? 'opencode.exe' : 'opencode');
const DAEMON_ENTRY = path.join(ASSET_ROOT, 'packages', 'daemon', 'src', 'cli.mjs');

const DATA_DIR = process.env.MATHMOVER_DATA_DIR || path.join(
  (IS_WIN && process.env.LOCALAPPDATA) || app.getPath('appData'), 'MathMover',
);
const LOG_DIR = path.join(DATA_DIR, 'logs');

let mainWindow = null;
let desktopTray = null;
let daemonChild = null;
let nextChild = null;
let quitting = false;
const ports = { ws: null, http: null, next: null };

function log(...args) {
  console.log('[mathmover-desktop]', ...args);
}

/**
 * Electron 的 profile（localStorage、缓存、窗口状态）默认在 %APPDATA%\mathmover-desktop。
 * 把它收进 %LOCALAPPDATA%\MathMover\electron：本机数据集中在一个根目录，也不让缓存
 * 跟着 Roaming 漫游。首次升级时把旧目录整体迁移过去（同一个盘时是 rename，很快）。
 * 必须在 app ready / 单实例锁之前调用。
 */
function setupUserData() {
  const target = path.join(DATA_DIR, 'electron');
  const legacy = app.getPath('userData');
  if (legacy !== target && fs.existsSync(legacy) && !fs.existsSync(target)) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(legacy, target);
      log('已迁移 Electron 配置：', legacy, '→', target);
    } catch (e) {
      log('迁移 Electron 配置失败，改为复制：', e instanceof Error ? e.message : e);
      try {
        fs.mkdirSync(target, { recursive: true });
        fs.cpSync(legacy, target, { recursive: true });
      } catch (copyError) {
        log('复制 Electron 配置失败：', copyError instanceof Error ? copyError.message : copyError);
      }
    }
  }
  fs.mkdirSync(target, { recursive: true });
  app.setPath('userData', target);
  try {
    app.setPath('sessionData', target);
  } catch (e) {
    log('设置 sessionData 失败：', e instanceof Error ? e.message : e);
  }
  // Electron 在 JS 跑之前会先建出默认 userData 目录；如果它是空的（没有需要迁移的
  // 用户数据），就清掉，避免 Roaming 里留一个空壳。
  try {
    if (legacy !== target && fs.existsSync(legacy) && fs.readdirSync(legacy).length === 0) {
      fs.rmdirSync(legacy);
    }
  } catch { /* 被占用就留着，下次再清 */ }
}

function fail(message, detail) {
  quitting = true;
  const text = detail ? `${message}\n\n${detail}` : message;
  log(text);
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    title: 'MathMover 启动失败',
    message,
    detail: (detail ? detail + '\n\n' : '') + `日志：${LOG_DIR}`,
    buttons: ['打开日志目录', '退出'],
    defaultId: 1,
    cancelId: 1,
  });
  if (choice === 0) void shell.openPath(LOG_DIR);
  app.quit();
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function pickPort(start, end, label, exclude = []) {
  for (let port = start; port <= end; port++) {
    if (exclude.includes(port)) continue;
    if (await portFree(port)) return port;
  }
  throw new Error(`找不到空闲的${label}端口（${start}-${end}）`);
}

function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, { timeout: 3000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error(`等待 ${url} 超时`));
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

function spawnLogged(name, command, args, options) {
  const out = fs.createWriteStream(path.join(LOG_DIR, `${name}.log`), { flags: 'a' });
  const child = spawn(command, args, { ...options, windowsHide: true, detached: IS_MAC });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  child.on('error', (err) => log(`${name} 启动失败：`, err));
  child.on('exit', (code, signal) => {
    log(`${name} 退出 code=${code} signal=${signal}`);
    if (!quitting && code !== 0) {
      fail(`${name} 意外退出（code=${code}）`, `详见 ${path.join(LOG_DIR, `${name}.log`)}`);
    }
  });
  return child;
}

function killTree(child) {
  if (!child || child.killed || !child.pid) return;
  try {
    if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else if (IS_MAC) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch (e) {
    log('结束子进程失败：', e);
  }
}

function envWithoutUndefined(env) {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));
}

async function startServices() {
  fs.mkdirSync(LOG_DIR, { recursive: true });

  // 三个端口都动态挑：渲染进程的 wsUrl 由 Next 服务端按运行时 env 注入，
  // 不再是构建期常量（见 app/dashboard/page.tsx）。
  const wsPort = await pickPort(WS_PORT_START, WS_PORT_START + 99, 'WebSocket');
  const httpPort = await pickPort(HTTP_PORT_START, HTTP_PORT_START + 99, 'daemon HTTP', [wsPort]);
  const nextPort = await pickPort(NEXT_PORT_START, NEXT_PORT_START + 199, 'Next', [wsPort, httpPort]);
  const daemonUrl = `http://127.0.0.1:${httpPort}`;
  ports.ws = wsPort; ports.http = httpPort; ports.next = nextPort;

  log(`daemon：ws=${wsPort} http=${httpPort}`);
  daemonChild = spawnLogged('daemon', NODE_BIN, [
    DAEMON_ENTRY,
    '--ws-port', String(wsPort),
    '--http-port', String(httpPort),
    '--data-dir', DATA_DIR,
    '--workdir', DATA_DIR,
    '--no-mcp',
  ], {
    cwd: DATA_DIR,
    env: envWithoutUndefined({ ...process.env, MATHMOVER_DATA_DIR: DATA_DIR }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHttp(`${daemonUrl}/api/health`, 20_000);

  log(`Next：${nextPort}`);
  nextChild = spawnLogged('next', NODE_BIN, [path.join(NEXT_DIR, 'server.js')], {
    cwd: NEXT_DIR,
    env: envWithoutUndefined({
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(nextPort),
      HOSTNAME: '127.0.0.1',
      NEXT_TELEMETRY_DISABLED: '1',
      MATHMOVER_DATA_DIR: DATA_DIR,
      MATHMOVER_ROOT: ASSET_ROOT,
      // 安装目录可能被用户选到只读位置；MCP 配置与 dsh patch 落到数据目录。
      MATHMOVER_MCP_DIR: path.join(DATA_DIR, 'mcp'),
      MATHMOVER_DAEMON_URL: daemonUrl,
      MATHMOVER_WS_PORT: String(wsPort),
      MATHMOVER_WS_URL: `ws://127.0.0.1:${wsPort}`,
      MATHMOVER_DESKTOP: '1',
      OPENCODE_BIN: fs.existsSync(OPENCODE_BIN) ? OPENCODE_BIN : undefined,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHttp(`http://127.0.0.1:${nextPort}/`, 90_000);

  return nextPort;
}

function diagnosticsText() {
  return [
    `MathMover ${app.getVersion()}`,
    `Electron ${process.versions.electron} / Chromium ${process.versions.chrome} / Node ${process.versions.node}`,
    `安装位置：${BUILD_ROOT}`,
    `数据目录：${DATA_DIR}`,
    `日志目录：${LOG_DIR}`,
    `端口：ws=${ports.ws} http=${ports.http} next=${ports.next}`,
  ].join('\n');
}

function openLogs() {
  void shell.openPath(LOG_DIR);
}

function showAbout() {
  const choice = dialog.showMessageBoxSync({
    type: 'info',
    title: '关于 MathMover',
    message: `MathMover ${app.getVersion()}`,
    detail: diagnosticsText(),
    buttons: ['打开日志目录', '确定'],
    defaultId: 1,
    cancelId: 1,
  });
  if (choice === 0) openLogs();
}

const TITLEBAR_COLORS = {
  light: { color: '#fdfcf8', symbolColor: '#1c1917' },
  dark: { color: '#181818', symbolColor: '#fafaf9' },
};

/** 原生窗口按钮与窗口边框跟随应用主题（Windows 的 DWM 也看 nativeTheme）。 */
function applyTitleBarTheme(theme) {
  const dark = theme === 'dark';
  nativeTheme.themeSource = dark ? 'dark' : 'light';
  if (process.platform === 'darwin' || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setTitleBarOverlay({ ...TITLEBAR_COLORS[dark ? 'dark' : 'light'], height: 39 });
  } catch (e) {
    log('设置标题栏颜色失败：', e instanceof Error ? e.message : e);
  }
}

/** 渲染进程标题栏菜单 → 主进程动作。只接受白名单，避免把 IPC 变成任意命令入口。 */
function installDesktopIpc() {
  const requireDesktopWindow = (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('无效的桌面设置请求');
    }
    if (!desktopTray) throw new Error('桌面设置尚未就绪');
    return desktopTray;
  };
  ipcMain.handle('desktop-preferences:get', (event) => requireDesktopWindow(event).getPreferences());
  ipcMain.handle('desktop-preferences:set-close-to-tray', (event, enabled) => requireDesktopWindow(event).setCloseToTray(enabled));
  ipcMain.on('desktop-action', (_event, action) => {
    if (action === 'check-updates') void checkForUpdates();
    else if (action === 'open-logs') openLogs();
    else if (action === 'copy-diagnostics') clipboard.writeText(diagnosticsText());
    else if (action === 'about') showAbout();
  });
  ipcMain.on('set-titlebar-theme', (_event, theme) => {
    applyTitleBarTheme(theme === 'dark' ? 'dark' : 'light');
  });
}

let updateCheck = null;
let updatePrompted = false;

/**
 * 自动更新。
 *
 * 发布源在 electron-builder.yml 的 `publish`（GitHub Releases，仓库公开、可匿名读）。
 * 本地验证用 `MATHMOVER_UPDATE_URL` 指向一个 generic 静态目录（见 scripts/verify-update.mjs）；
 * `MATHMOVER_UPDATE_AUTOINSTALL=1` 时下载完直接静默安装，便于自动化跑完整升级闭环。
 */
function setupUpdater() {
  if (!app.isPackaged) return;
  // macOS 测试包只有本地签名，不能走要求 Developer ID 的 Squirrel.Mac 更新链路。
  if (IS_MAC) { log('macOS 测试版：跳过自动更新'); return; }
  // `electron-builder --dir` 的产物没有 app-update.yml（正式安装包才有）；
  // 本地 unpacked 调试时跳过，避免每轮启动打一条 ENOENT。
  if (!process.env.MATHMOVER_UPDATE_URL && !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    log('未找到 app-update.yml（unpacked 构建），跳过自动更新');
    return;
  }
  if (process.env.MATHMOVER_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.MATHMOVER_UPDATE_URL });
  }
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (e) => log('更新检查失败：', e instanceof Error ? e.message : e));
  autoUpdater.on('update-available', (info) => log(`发现新版本 ${info.version}，开始下载`));
  autoUpdater.on('update-downloaded', (info) => {
    if (process.env.MATHMOVER_UPDATE_AUTOINSTALL === '1') {
      log(`更新 ${info.version} 已下载，静默安装`);
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
      return;
    }
    if (updatePrompted) return;
    updatePrompted = true;
    const choice = dialog.showMessageBoxSync({
      type: 'info',
      title: '更新已就绪',
      message: `MathMover ${info.version} 已下载`,
      detail: '重启应用即可完成更新。选择「稍后」会在下次退出时自动安装。',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) autoUpdater.quitAndInstall(true, true);
  });

  // 启动后静默检查一次；新版本会在后台下载，下载完才打扰用户
  setTimeout(() => { void checkForUpdates({ silent: true }); }, 15_000);
}

async function checkForUpdates({ silent = false } = {}) {
  if (IS_MAC) {
    if (!silent) dialog.showMessageBoxSync({
      type: 'info', title: '检查更新', message: 'macOS 测试版暂不支持自动更新。',
      detail: '请下载新版后手动替换应用。',
    });
    return;
  }
  if (!app.isPackaged) {
    if (!silent) dialog.showMessageBoxSync({ type: 'info', title: '检查更新', message: '开发模式下不检查更新。' });
    return;
  }
  if (updateCheck) return updateCheck;
  updateCheck = (async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!silent && result?.updateInfo?.version === app.getVersion()) {
        dialog.showMessageBoxSync({
          type: 'info', title: '检查更新',
          message: '当前已是最新版本。', detail: `版本 ${app.getVersion()}`,
        });
      }
    } catch (e) {
      log('更新检查失败：', e instanceof Error ? e.message : e);
      if (!silent) {
        dialog.showMessageBoxSync({
          type: 'error', title: '检查更新失败', message: '无法连接更新服务。',
          detail: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      updateCheck = null;
    }
  })();
  return updateCheck;
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'MathMover',
      submenu: [
        ...(IS_MAC ? [
          { label: '关于 MathMover', click: showAbout },
          { type: 'separator' },
        ] : []),
        { label: '检查更新…', click: () => { void checkForUpdates(); } },
        { label: '打开日志目录', click: openLogs },
        { label: '复制诊断信息', click: () => clipboard.writeText(diagnosticsText()) },
        { type: 'separator' },
        ...(IS_MAC ? [
          { role: 'hide', label: '隐藏 MathMover' },
          { role: 'hideOthers', label: '隐藏其他应用' },
          { role: 'unhide', label: '显示全部' },
          { type: 'separator' },
        ] : []),
        { role: 'quit', label: '退出' },
      ],
    },
    // Mac 的文本输入、剪贴板快捷键依赖原生 Edit 菜单。
    ...(IS_MAC ? [{ role: 'editMenu', label: '编辑' }] : []),
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
      ],
    },
    {
      label: '帮助',
      submenu: [{ label: '关于 MathMover', click: showAbout }],
    },
  ]));
}

function createWindow(nextPort) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#FDFCF8',
    title: 'MathMover',
    // 隐藏系统标题栏，只保留系统画的窗口按钮（overlay）；标题栏由渲染进程绘制。
    titleBarStyle: 'hidden',
    // 39 < 标题栏的 40px：把最底下 1px 留给应用自己的分隔线，避免被原生按钮遮罩盖住
    ...(IS_MAC
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: { color: '#fdfcf8', symbolColor: '#1c1917', height: 39 } }),
    // 菜单仍在（Alt 可唤出），但默认不占一条系统菜单栏；常用操作在应用内标题栏菜单里。
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  // Windows 注销/关机不会触发 before-quit，同样需要结束后台服务。
  mainWindow.on('session-end', () => {
    quitting = true;
    killTree(nextChild);
    killTree(daemonChild);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !url.startsWith(`http://127.0.0.1:${nextPort}`)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${nextPort}`)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  // 首次启动且还没配过端点：把设置弹窗带出来。普通用户不知道还要先配模型；
  // 只看一次（marker 落盘），之后关掉就不会再自动弹。
  const marker = path.join(DATA_DIR, '.desktop-onboarded');
  const onboarding = !fs.existsSync(marker) && !fs.existsSync(path.join(DATA_DIR, 'byok.json'));
  mainWindow.loadURL(`http://127.0.0.1:${nextPort}/dashboard${onboarding ? '?onboarding=1' : ''}`);
  try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* 只影响下次是否再弹 */ }
  if (process.env.MATHMOVER_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' });
}

setupUserData();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => desktopTray?.showWindow());
  app.on('activate', () => desktopTray?.showWindow());

  app.whenReady().then(async () => {
    // 先落浅色，避免启动瞬间闪出系统暗色标题栏；渲染进程挂载后会按实际主题纠正。
    nativeTheme.themeSource = 'light';
    installDesktopIpc();
    try {
      await restoreMacPath(path.dirname(NODE_BIN), log);
      const nextPort = await startServices();
      installMenu();
      setupUpdater();
      createWindow(nextPort);
      desktopTray = createSystemTray({
        window: mainWindow,
        iconPath: path.join(__dirname, '..', 'build-resources', IS_MAC ? 'trayTemplate.png' : 'icon.ico'),
        preferencesPath: path.join(DATA_DIR, 'desktop-settings.json'),
        onCheckUpdates: checkForUpdates,
        log,
      });
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }).catch((e) => fail(e instanceof Error ? e.message : String(e)));

  app.on('before-quit', () => {
    quitting = true;
    killTree(nextChild);
    killTree(daemonChild);
  });

  app.on('window-all-closed', () => app.quit());
  if (IS_MAC) {
    process.on('SIGTERM', () => app.quit());
    process.on('SIGINT', () => app.quit());
  }
}
