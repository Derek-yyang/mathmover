/**
 * 桌面壳的 Agent 多轮冒烟：本地 OpenAI 兼容 mock + 临时 BYOK 配置，
 * 在打包版界面里连发两轮，验证：
 *   1. /api/agent 能拉起随包 OpenCode，模型回复真的出现在界面上；
 *   2. 第二轮请求里带着第一轮的用户话与助手回复（原生会话续上了，不是每轮重开）。
 *
 * 跑法（仓库根目录）：node desktop/scripts/verify-agent.mjs [exePath]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const exe = path.resolve(process.argv[2] || 'desktop/release/win-unpacked/MathMover.exe');
const MODEL = 'mock-model';
const API_KEY = 'mm-mock-key';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = [];

// ── mock 端点 ─────────────────────────────────────────────────────
const sse = (chunks) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* 忽略 */ }
    console.log(`[mock] ${req.method} ${req.url} ${body.length}B`);
    seen.push({ url: req.url, auth: req.headers.authorization ?? null, body: parsed });
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL, object: 'model' }] }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(sse([
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: MODEL, choices: [{ index: 0, delta: { role: 'assistant', content: 'MOCK-OK' }, finish_reason: null }] },
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]));
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const mockPort = mock.address().port;

// ── 临时数据目录 + BYOK 配置 ──────────────────────────────────────
const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-agent-'));
const dataDir = path.join(tempData, 'MathMover');
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'byok.json'), JSON.stringify({
  apiFormat: 'openai-chat',
  baseUrl: `http://127.0.0.1:${mockPort}/v1`,
  model: MODEL,
  apiKey: API_KEY,
  reasoningLevels: '',
}, null, 2));

const tempRoaming = path.join(tempData, 'Roaming');
fs.mkdirSync(tempRoaming, { recursive: true });
const env = { ...process.env, LOCALAPPDATA: tempData, APPDATA: tempRoaming };
delete env.ELECTRON_RUN_AS_NODE;

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
const app = spawn(exe, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(tempData, 'profile')}`], { cwd: path.dirname(exe), env, stdio: ['ignore', 'pipe', 'pipe'] });
const appLog = [];
app.stdout.on('data', (c) => appLog.push(String(c)));
app.stderr.on('data', (c) => appLog.push(String(c)));
const killApp = () => { if (app.exitCode === null) spawn('taskkill', ['/pid', String(app.pid), '/T', '/F'], { windowsHide: true }); };

let browser;
try {
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
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 120_000 });
  // 运行时选择存在 localStorage（mm.agentId）：先切到内置 Agent，再刷新让它生效
  await page.evaluate(() => localStorage.setItem('mm.agentId', 'byok'));
  await page.reload();
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 120_000 });
  await page.waitForFunction(() => typeof window.__mmGgb?.apply === 'function', null, { timeout: 60_000 });
  const composer = page.locator('[aria-label="题目描述"]');
  const send = page.locator('[aria-label="发送消息"]');
  await composer.waitFor({ timeout: 60_000 });

  async function turn(text) {
    const before = await page.evaluate(() => (document.body.innerText.match(/MOCK-OK/g) ?? []).length);
    await composer.fill(text);
    // 空输入时 Send 本来就是禁用的——先填字，再等它可用（sendBlock 会体现在 title 上）
    try {
      await page.waitForFunction(() => {
        const button = document.querySelector('[aria-label="发送消息"]');
        return button && !button.disabled;
      }, null, { timeout: 40_000 });
    } catch (e) {
      const why = await page.evaluate(() => document.querySelector('[aria-label="发送消息"]')?.getAttribute('title'));
      throw new Error(`发送按钮一直不可用（title=${why}）`);
    }
    await send.click();
    await page.waitForFunction(
      (n) => (document.body.innerText.match(/MOCK-OK/g) ?? []).length > n,
      before,
      { timeout: 180_000 },
    );
  }

  try {
    await turn('第一句话：只回复 MOCK-OK。');
    await turn('第二句话：再回复一次 MOCK-OK。');
  } catch (e) {
    console.log('turn 失败，当前界面：\n' + (await page.evaluate(() => document.body.innerText)).slice(0, 1200));
    console.log('页面错误：' + (errors.join(' | ') || '(无)'));
    console.log('mock 收到：' + JSON.stringify(seen.map((s) => s.url)));
    await page.screenshot({ path: path.join(tempData, 'failure.png') }).catch(() => {});
    throw e;
  }

  const chatHits = seen.filter((s) => s.url?.includes('/chat/completions'));
  const second = chatHits.at(-1);
  const secondText = JSON.stringify(second?.body?.messages ?? []);
  const checks = [
    ['mock 端点收到两轮请求', chatHits.length >= 2],
    ['密钥以 Bearer 发出', chatHits.every((s) => s.auth === `Bearer ${API_KEY}`)],
    ['第二轮带上了第一轮用户消息', secondText.includes('第一句话')],
    ['第二轮带上了第一轮助手回复', secondText.includes('MOCK-OK')],
    ['MCP 配置与 dsh patch 落在数据目录', fs.existsSync(path.join(dataDir, 'mcp', 'runtime-mcp.json')) && fs.existsSync(path.join(dataDir, 'mcp', 'dsh-mathmover.patch.yml'))],
    ['界面没有脚本错误', errors.length === 0],
  ];
  let failed = 0;
  for (const [label, ok] of checks) { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failed++; }
  if (errors.length) console.log('error: ' + errors.join(' | '));
  if (failed) {
    console.log('mock 收到：' + JSON.stringify(seen.map((s) => s.url)));
    throw new Error(`${failed} 项检查未过`);
  }
  console.log(`PASS: 打包版完成两轮对话，第二轮请求含第一轮上下文（mock 收到 ${chatHits.length} 次）`);
  console.log(`  临时数据目录：${tempData}`);
} finally {
  await browser?.close().catch(() => {});
  killApp();
  mock.close();
}
