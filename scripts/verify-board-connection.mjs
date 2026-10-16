import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Real dashboard and GeoGebra. HTTP persistence and daemon sockets are isolated fixtures.
const base = process.argv[2] || 'http://localhost:3000';
const out = 'spike-out/board-connection';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1544, height: 900 } });
const errors = [], sockets = [], replies = [], bindings = [];
let mode = 'hold', releaseBinding;
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let record = { id, title: '连接状态验证', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), messages: [], commands: ['A=(1,2)'] };
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true });
});
await page.route('**/api/agent**', route => {
  assert.equal(route.request().method(), 'GET', 'no real Agent may run');
  return route.fulfill({ json: { runtimes: [{ id: 'claude-code', name: 'Claude Code', version: 'fixture', usable: true }] } });
});
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.route('**/api/coursewares**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/windows')) {
    bindings.push(route.request().postDataJSON().windowId);
    if (mode === 'hold') await new Promise(resolve => { releaseBinding = resolve; });
    if (mode === 'offline') return route.fulfill({ status: 503, json: { error: 'fixture unavailable' } });
    return route.fulfill({ json: { bindingToken: 'fixture-ticket' } });
  }
  if (route.request().method() === 'POST') {
    assert.equal(url.pathname, '/api/coursewares', 'only fixture autosaves may mutate records');
    const body = route.request().postDataJSON();
    record = { ...record, ...body, revision: (body.expectedRevision ?? record.revision) + 1 };
    return route.fulfill({ json: record });
  }
  return route.fulfill({ json: url.pathname.endsWith(id) ? record : { records: [record], capabilities: { archive: true, permanentDelete: true } } });
});
await page.routeWebSocket('ws://127.0.0.1:8787', socket => {
  sockets.push(socket);
  socket.onMessage(data => replies.push(JSON.parse(String(data))));
});
const status = page.getByRole('status', { name: '画板连接状态', exact: true });
const reconnect = page.getByRole('button', { name: '重新连接画板', exact: true });
try {
  await stubConstructionDraft(page);
  await page.goto(`${base}/dashboard?history_id=${id}`);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForFunction(() => typeof window.ggbApplet?.getAllObjectNames === 'function');
  await page.waitForFunction(() => document.querySelector('[data-board-connection]')?.dataset.boardConnection === 'connecting');
  assert.equal(await status.textContent(), '连接中…');
  await page.screenshot({ path: `${out}/connecting.png` });
  mode = 'online'; releaseBinding();
  await page.waitForFunction(() => document.querySelector('[data-board-connection]')?.dataset.boardConnection === 'connected');
  assert.equal(await status.textContent(), '已连接');
  assert.equal(await reconnect.count(), 0);
  assert.equal(sockets.length, 1);
  await page.waitForTimeout(150);
  assert.equal(replies[0].bindingToken, 'fixture-ticket');
  await page.screenshot({ path: `${out}/connected.png` });

  // Disconnection does not remove the current applet or prevent manual drawing.
  const applet = await page.evaluateHandle(() => window.ggbApplet);
  mode = 'offline'; sockets[0].close({ code: 1001, reason: 'fixture disconnect' });
  await reconnect.waitFor();
  assert.equal(await status.textContent(), '未连接');
  await page.evaluate(() => window.ggbApplet.evalCommand('B=(3,4)'));
  assert(await page.evaluate(() => window.ggbApplet.exists('B')));
  await page.waitForTimeout(2300);
  assert.equal(await status.textContent(), '未连接');
  assert.equal(sockets.length, 1, 'failed binding must not create an unbound socket');
  await page.screenshot({ path: `${out}/disconnected.png` });

  mode = 'hold'; await reconnect.click();
  await page.waitForFunction(() => document.querySelector('[data-board-connection]')?.dataset.boardConnection === 'connecting');
  await page.waitForTimeout(150);
  mode = 'online'; releaseBinding();
  await page.waitForFunction(() => document.querySelector('[data-board-connection]')?.dataset.boardConnection === 'connected');
  assert(await page.evaluate(api => api === window.ggbApplet, applet), 'retry retains the exact applet instance');
  assert(bindings.every(windowId => windowId === bindings[0]), 'retry preserves ownership of this window');
  assert.equal(sockets.length, 2);
  sockets[1].send(JSON.stringify({ id: 'test-ping', op: 'ping' }));
  for (let i = 0; i < 30 && !replies.some(reply => reply.id === 'test-ping'); i++) await page.waitForTimeout(100);
  assert.equal(replies.find(reply => reply.id === 'test-ping')?.payload, true);
  sockets[1].send(JSON.stringify({ id: 'test-apply', op: 'apply', args: { commands: ['C=(5,6)'], incremental: true, ledger: ['A=(1,2)', 'B=(3,4)', 'C=(5,6)'] } }));
  for (let i = 0; i < 100 && !replies.some(reply => reply.id === 'test-apply'); i++) await page.waitForTimeout(100);
  const apply = replies.find(reply => reply.id === 'test-apply');
  assert.equal(apply?.error, undefined);
  assert(apply?.payload.applied.includes('C=(5,6)'), 'daemon tool execution still reaches the host executor');
  assert(await page.evaluate(() => window.ggbApplet.exists('C')));

  sockets[1].close({ code: 1001, reason: 'fixture automatic recovery' });
  await reconnect.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-board-connection]')?.dataset.boardConnection === 'connected');
  assert.equal(sockets.length, 3, 'service recovery reconnects automatically without a click');
  assert(await page.evaluate(api => api === window.ggbApplet, applet));

  await page.getByRole('button', { name: '全屏演示', exact: true }).click();
  assert(await status.isVisible(), 'connection status remains visible in fullscreen');
  await page.screenshot({ path: `${out}/fullscreen.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('separator', { name: '调整聊天区宽度' }).focus();
  await page.keyboard.press('End');
  await page.waitForTimeout(300);
  const dimensions = await page.locator('header').last().evaluate(header => ({ width: header.clientWidth, scroll: header.scrollWidth }));
  assert.equal(dimensions.width, dimensions.scroll, 'narrow canvas controls do not overflow');
  assert(await status.isVisible());
  await page.screenshot({ path: `${out}/narrow.png` });
  assert.deepEqual(errors, []);
  const result = { connecting: true, connected: true, disconnected: true, autoReconnect: true,
    manualReconnect: true, preservesApplet: true, sameWindow: true, toolExecution: true, fullscreen: true, narrow: dimensions, pageErrors: errors };
  await writeFile(`${out}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
