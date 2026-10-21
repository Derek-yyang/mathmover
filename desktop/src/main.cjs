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
const { app, BrowserWindow, shell, dialog, clipboard, Menu } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const IS_WIN = process.platform === 'win32';
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

const DATA_DIR = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'MathMover');
const LOG_DIR = path.join(DATA_DIR, 'logs');

let mainWindow = null;
let daemonChild = null;
let nextChild = null;
let quitting = false;
const ports = { ws: null, http: null, next: null };

function log(...args) {
  console.log('[mathmover-desktop]', ...args);
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
  const child = spawn(command, args, { ...options, windowsHide: true });
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

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'MathMover',
      submenu: [
        { label: '打开日志目录', click: openLogs },
        { label: '复制诊断信息', click: () => clipboard.writeText(diagnosticsText()) },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
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
      submenu: [{
        label: '关于 MathMover',
        click: () => {
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
        },
      }],
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      const nextPort = await startServices();
      installMenu();
      createWindow(nextPort);
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
}
