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
// 冒烟不碰真实数据目录：LOCALAPPDATA 指向临时目录，主进程的 DATA_DIR 随之隔离
const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-desktop-'));
const env = { ...process.env, LOCALAPPDATA: tempData };
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
const app = spawn(exe, [`--remote-debugging-port=${debugPort}`], {
  cwd: path.dirname(exe),
  env: { ...env, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const appLog = [];
app.stdout.on('data', (c) => appLog.push(String(c)));
app.stderr.on('data', (c) => appLog.push(String(c)));

const killApp = () => {
  if (app.exitCode !== null) return;
  spawn('taskkill', ['/pid', String(app.pid), '/T', '/F'], { windowsHide: true });
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

  // 首次启动引导：数据目录是全新的，设置弹窗应该自动打开
  const onboarding = await page.locator('[data-slot="settings-dialog"]').waitFor({ timeout: 15_000 }).then(() => true, () => false);
  if (!onboarding) throw new Error('首次启动没有自动打开设置弹窗');
  await page.keyboard.press('Escape');
  await page.locator('[data-slot="settings-dialog"]').waitFor({ state: 'detached', timeout: 10_000 });

  // 桌面自定义标题栏：存在、菜单能开合（放在引导关闭之后，避免弹窗遮罩拦截点击）
  await page.locator('[data-slot="desktop-titlebar"]').waitFor({ timeout: 30_000 });
  const desktopMenu = page.locator('[aria-label="桌面菜单"]');
  await desktopMenu.click();
  await page.locator('[role="menu"][aria-label="桌面菜单项"]').waitFor({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  await page.locator('[role="menu"][aria-label="桌面菜单项"]').waitFor({ state: 'detached', timeout: 5_000 });

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
