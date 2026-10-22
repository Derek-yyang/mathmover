/**
 * 桌面壳冒烟：直接启动 release/win-unpacked/MathMover.exe（固定 CDP 端口），
 * 用 connectOverCDP 接管窗口，验证：
 *   1. 窗口落在 /dashboard，GeoGebra 实例创建成功；
 *   2. 通过页面内的 __mmGgb 下发一条构造，Next → daemon → WebSocket → 画布全通；
 *   3. 没有脚本错误 / HTTP 失败。
 *
 * 为什么不用 Playwright 的 _electron.launch：它在共享 Electron profile、
 * 或环境里带 ELECTRON_RUN_AS_NODE 的机器上会卡在启动握手；CDP 这条路更稳，也更接近用户启动方式。
 *
 * 跑法（仓库根目录）：node desktop/scripts/verify.mjs [exePath]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const exe = path.resolve(process.argv[2] || 'desktop/release/win-unpacked/MathMover.exe');
const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-desktop-'));
// 冒烟不碰真实数据目录：LOCALAPPDATA/APPDATA 都指向临时目录，数据目录与 Electron
// profile 一起隔离（主进程会把 profile 收进 <LOCALAPPDATA>\MathMover\electron）。
const tempRoaming = path.join(tempData, 'Roaming');
fs.mkdirSync(tempRoaming, { recursive: true });
// 伪造旧的 Roaming profile：验证主进程会把整个目录迁到 <LOCALAPPDATA>\MathMover\electron
const legacyProfile = path.join(tempData, 'legacy-profile');
fs.mkdirSync(path.join(legacyProfile, 'Local Storage'), { recursive: true });
fs.writeFileSync(path.join(legacyProfile, 'Local Storage', 'migrated.txt'), 'old-profile');
const env = { ...process.env, LOCALAPPDATA: tempData, APPDATA: tempRoaming, MATHMOVER_DATA_DIR: path.join(tempData, 'MathMover') };
// 开发 shell 里可能全局有 ELECTRON_RUN_AS_NODE=1：那会让 exe 以纯 Node 启动、主进程不执行
delete env.ELECTRON_RUN_AS_NODE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function getJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body ? JSON.parse(body) : null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

const debugPort = await freePort();
// 先占住 8787，逼桌面壳去挑别的 WebSocket 端口（动态端口验证）
const squatter = net.createServer();
const squatted = await new Promise((resolve) => {
  squatter.once('error', () => resolve(false));
  squatter.listen(8787, '127.0.0.1', () => resolve(true));
});
const app = spawn(exe, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${legacyProfile}`], {
  cwd: path.dirname(exe),
  env: { ...env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const appLog = [];
app.stdout.on('data', (c) => appLog.push(String(c)));
app.stderr.on('data', (c) => appLog.push(String(c)));

const killApp = () => {
  if (app.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(app.pid), '/T', '/F'], { windowsHide: true });
  else app.kill('SIGTERM');
};

let browser;
try {
  // 等 DevTools 端点
  let version = null;
  for (let i = 0; i < 120 && !version; i++) {
    version = await getJson(`http://127.0.0.1:${debugPort}/json/version`);
    if (!version) await sleep(250);
  }
  if (!version) throw new Error('DevTools 端点没有起来\n' + appLog.join(''));

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  let page = null;
  for (let i = 0; i < 480 && !page; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('/dashboard')) ?? null;
    if (!page) await sleep(250);
  }
  if (!page) throw new Error('没有找到 /dashboard 窗口\n' + appLog.join(''));

  const errors = [];
  const failed = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('response', async (res) => {
    if (res.status() < 400) return;
    let body = '';
    try { body = (await res.text()).slice(0, 300); } catch { /* 图片等二进制 */ }
    failed.push(`${res.status()} ${res.request().method()} ${res.url()}\n  ${body}`);
  });

  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 120_000 });
  await page.waitForFunction(() => typeof window.__mmGgb?.apply === 'function', null, { timeout: 60_000 });

  // Electron profile 已收进数据目录，且旧 Roaming 目录被整体迁移（不是复制后留着）
  const profileDir = path.join(tempData, 'MathMover', 'electron');
  if (!fs.existsSync(path.join(profileDir, 'Local Storage', 'migrated.txt'))) {
    throw new Error('Electron profile 没有迁移到数据目录：' + profileDir);
  }

  // 首次启动引导：数据目录是全新的，设置弹窗应该自动打开
  const onboarding = await page.locator('[data-slot="settings-dialog"]').waitFor({ timeout: 15_000 }).then(() => true, () => false);
  if (!onboarding) throw new Error('首次启动没有自动打开设置弹窗');
  await page.keyboard.press('Escape');
  await page.locator('[data-slot="settings-dialog"]').waitFor({ state: 'detached', timeout: 10_000 });

  // 桌面自定义标题栏：存在、菜单能开合（放在引导关闭之后，避免弹窗遮罩拦截点击）
  await page.locator('[data-slot="desktop-titlebar"]').waitFor({ timeout: 30_000 });
  if (process.platform === 'darwin') {
    const padding = await page.locator('[data-slot="desktop-titlebar"]').evaluate(el => getComputedStyle(el).paddingLeft);
    if (padding !== '88px') throw new Error('macOS 标题栏未避让原生窗口按钮：' + padding);
  }
  const desktopMenu = page.locator('[aria-label="桌面菜单"]');
  await desktopMenu.click();
  await page.locator('[role="menu"][aria-label="桌面菜单项"]').waitFor({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  await page.locator('[role="menu"][aria-label="桌面菜单项"]').waitFor({ state: 'detached', timeout: 5_000 });

  // 收起态：顶部不再重复品牌，改为明确的展开图标；新建/搜索图标仍在
  await page.locator('[aria-label="收起侧栏"]').click();
  await page.waitForFunction(() => document.querySelector('.dashboard-sidebar')?.getAttribute('data-collapsed') === 'true', null, { timeout: 10_000 });
  const collapsed = await page.evaluate(() => ({
    brand: document.querySelector('.rail-brand-mark') ? getComputedStyle(document.querySelector('.rail-brand-mark')).display : 'missing',
    expand: document.querySelector('.rail-expand-icon') ? getComputedStyle(document.querySelector('.rail-expand-icon')).display : 'missing',
    hasNew: !!document.querySelector('.sidebar-rail [aria-label="新建课件"]'),
  }));
  if (collapsed.brand !== 'none' || collapsed.expand === 'none' || !collapsed.hasNew) {
    throw new Error('收起态图标不对：' + JSON.stringify(collapsed));
  }
  await page.screenshot({ path: path.join(tempData, 'shell-collapsed.png') });
  await page.locator('[aria-label="展开侧栏"]').click();
  await page.waitForFunction(() => document.querySelector('.dashboard-sidebar')?.getAttribute('data-collapsed') === 'false', null, { timeout: 10_000 });

  // 深色主题：应用内标题栏跟随；原生按钮颜色由 preload IPC 同步（这里只能断言 DOM）
  await page.evaluate(() => localStorage.setItem('mm.theme', 'dark'));
  await page.reload();
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 120_000 });
  await page.waitForFunction(() => {
    const bar = document.querySelector('[data-slot="desktop-titlebar"]');
    return bar && getComputedStyle(bar).backgroundColor === 'rgb(24, 24, 24)';
  }, null, { timeout: 15_000 });
  await page.screenshot({ path: path.join(tempData, 'shell-dark.png') });
  // 回到浅色继续构造验证
  await page.evaluate(() => localStorage.setItem('mm.theme', 'light'));
  await page.reload();
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 120_000 });
  await page.waitForFunction(() => typeof window.__mmGgb?.apply === 'function', null, { timeout: 60_000 });

  // 桌面工作台不允许整页滚动（画布/对话各自内部滚动）
  const layout = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    docScrollHeight: document.documentElement.scrollHeight,
    bodyScrollHeight: document.body.scrollHeight,
    rootHeight: document.querySelector('[data-slot="dashboard-root"]')?.getBoundingClientRect().height ?? null,
    titlebarHeight: document.querySelector('[data-slot="desktop-titlebar"]')?.getBoundingClientRect().height ?? null,
    offenders: [...document.querySelectorAll('*')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { tag: el.tagName, slot: el.getAttribute('data-slot'), cls: String(el.className ?? '').slice(0, 90), top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
      })
      .filter((x) => x.bottom > window.innerHeight + 1)
      .slice(0, 12),
  }));
  if (layout.docScrollHeight > layout.innerHeight + 1) {
    throw new Error('页面出现整页滚动：' + JSON.stringify(layout));
  }
  const sidebar = await page.evaluate(() => {
    const el = document.querySelector('[data-sidebar="sidebar"]');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  if (!sidebar || sidebar.height <= 0) throw new Error('侧栏高度异常：' + JSON.stringify(sidebar));

  // 真画一条：Next → daemon → WebSocket → GeoGebra 整条写路径
  const drawn = await page.evaluate(async () => {
    await window.__mmGgb.apply({
      commands: ['MODE: 2D', 'A = (0, 0)', 'B = (4, 3)', 'c = Segment(A, B)'],
      incremental: false,
    });
    return { objects: window.ggbApplet.getObjectNumber(), names: window.ggbApplet.getAllObjectNames() };
  });
  if (!drawn.names.includes('A') || !drawn.names.includes('c')) {
    throw new Error('构造没有落到画布：' + JSON.stringify(drawn));
  }

  // 随包 OpenCode 必须能被探测到（多轮对话的前提）；本机 claude/codex 没装也不影响
  const agent = await page.evaluate(async () => {
    const res = await fetch('/api/agent?fresh=1', { cache: 'no-store' });
    return { status: res.status, body: await res.json() };
  });
  const builtin = agent.body?.runtimes?.find((r) => r.id === 'byok');
  if (agent.status !== 200 || !builtin) throw new Error('运行时清单异常：' + JSON.stringify(agent));
  if (!builtin.usable) throw new Error('内置 Agent 不可用（随包 opencode 没找到？）：' + JSON.stringify(builtin));

  const info = await page.evaluate(() => ({
    title: document.title,
    href: location.href,
    objects: window.ggbApplet.getObjectNumber(),
    hasStage: !!document.querySelector('.geogebra-stage'),
  }));
  if (!info.hasStage) throw new Error('没有找到 .geogebra-stage');
  if (failed.length) throw new Error('HTTP 失败请求：\n' + failed.join('\n'));
  if (errors.length) throw new Error('浏览器错误：\n' + errors.join('\n'));

  console.log(`PASS: 桌面壳启动并完成一次构造 → ${info.href}`);
  console.log(`  title=${info.title} objects=${info.objects}（A/B/c 已落到画布）0 浏览器错误`);
  console.log(`  首次启动引导：设置弹窗已自动打开；8787 被占用=${squatted}（WebSocket 改用动态端口）`);
  console.log(`  自定义标题栏：存在且菜单可开合`);
  const shot = path.join(tempData, 'shell.png');
  await page.screenshot({ path: shot });
  console.log(`  截图：${shot}`);
  console.log(`  临时数据目录：${tempData}`);
} finally {
  await browser?.close().catch(() => {});
  killApp();
  squatter.close();
}
