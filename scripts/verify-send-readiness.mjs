import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Actual UI and local GeoGebra, isolated database/config/socket/model fixtures.
const out = 'spike-out/send-readiness';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const errors = [], sockets = [], results = [];
let online = false, agentMode = 'unusable', releaseDetection;
let record = { id, title: '发送条件验证', revision: 1, archived_at: null, messages: [], commands: ['A=(1,2)'],
  created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('mm.agentId', 'fixture-agent');
  window.__agentRequests = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (new URL(String(input), location.href).pathname === '/api/agent' && init?.method === 'POST') {
      window.__agentRequests.push(JSON.parse(init.body));
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        init.signal.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), { once: true });
      } }), { headers: { 'content-type': 'application/x-ndjson' } }));
    }
    return realFetch(input, init);
  };
});
await page.route('**/api/agent**', async route => {
  assert.equal(route.request().method(), 'GET', 'no real Agent POST may run');
  if (agentMode === 'hold') await new Promise(resolve => { releaseDetection = resolve; });
  if (agentMode === 'fail') return route.fulfill({ status: 503, json: { error: 'fixture discovery failed' } });
  return route.fulfill({ json: { runtimes: agentMode === 'missing' ? [] : [{ id: 'fixture-agent', name: '测试 Agent',
    version: 'fixture', usable: agentMode !== 'unusable', authStatus: agentMode === 'unauthenticated' ? 'missing' : 'unknown', canAttachImages: true }] } });
});
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.route('**/api/coursewares**', async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.pathname.endsWith('/windows')) return route.fulfill(online
    ? { json: { bindingToken: 'fixture-ticket' } } : { status: 503, json: { error: 'fixture offline' } });
  if (req.method() === 'GET') return route.fulfill({ json: url.pathname.endsWith(id) ? record : { records: [record], capabilities: { archive: true, permanentDelete: true } } });
  assert.equal(url.pathname, '/api/coursewares', 'only fixture snapshot autosaves may mutate');
  assert.equal(req.method(), 'POST');
  const body = req.postDataJSON();
  record = { ...record, ...body, revision: (body.expectedRevision ?? record.revision) + 1 };
  return route.fulfill({ json: record });
});
await page.routeWebSocket('ws://127.0.0.1:8787', socket => {
  sockets.push(socket);
  socket.onMessage(() => {});
});
const input = page.getByRole('textbox', { name: '题目描述', exact: true });
const send = page.getByRole('button', { name: '发送消息', exact: true });
const draftImages = page.locator('[aria-label=待发送图片] img');
const panel = page.locator('aside[aria-label=对话]');
const refreshFromSettings = async mode => {
  agentMode = mode;
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '刷新检测', exact: true }).click();
  if (mode !== 'hold') await page.getByRole('button', { name: '刷新检测', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
};
const assertBlocked = async (message, { transient = false } = {}) => {
  const notice = panel.getByText(message, { exact: true });
  await notice.waitFor({ state: 'attached' });
  assert.equal(await notice.locator('..').evaluate(node => node.classList.contains('sr-only')), transient,
    'only actionable problems take up visible space below the composer');
  assert(await send.isDisabled());
  assert.equal(await send.getAttribute('title'), message, 'send hover retains the blocking reason');
  assert.equal(await send.getAttribute('aria-describedby'), await notice.locator('..').getAttribute('id'));
  const before = await input.inputValue();
  await input.press('Enter');
  assert((await input.inputValue()).startsWith(before));
  assert.equal(await draftImages.count(), 1, 'blocked send retains the image');
  assert.equal(await page.evaluate(() => window.__agentRequests.length), 0, 'blocked sends make no Agent request');
  assert.equal(await panel.getByText('本轮中断', { exact: true }).count(), 0, 'blocked sends create no failed turn');
  results.push(message);
};
try {
  await stubConstructionDraft(page);
  await page.goto(`${process.argv[2] || 'http://localhost:3000'}/dashboard?history_id=${id}`);
  await page.waitForFunction(() => window.ggbApplet?.exists?.('A'));
  await page.waitForFunction(() => document.querySelector('[data-board-connection]')?.dataset.boardConnection === 'disconnected');
  await page.addStyleTag({ content: 'nextjs-portal {display:none !important;}' });
  await input.fill('保留文字和图片');
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    canvas.getContext('2d').fillRect(0, 0, 10, 10);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({ name: '题图.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await draftImages.waitFor();
  await assertBlocked('画板未连接，连接后即可发送。');
  await page.screenshot({ path: `${out}/disconnected.png` });
  online = true;
  await panel.getByRole('button', { name: '重新连接', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-board-connection]')?.dataset.boardConnection === 'connected');
  await assertBlocked('当前 Agent 不可用，请检查设置。');
  await panel.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await refreshFromSettings('missing');
  await assertBlocked('未选择可用 Agent，请在设置中选择。');
  await refreshFromSettings('hold');
  await assertBlocked('正在检测 Agent，请稍候。', { transient: true });
  await panel.getByRole('status', { name: '正在检测 Agent…', exact: true }).waitFor();
  await page.screenshot({ path: `${out}/detecting.png` });
  agentMode = 'missing'; releaseDetection();
  await panel.getByText('未选择可用 Agent，请在设置中选择。', { exact: true }).waitFor();
  await refreshFromSettings('fail');
  await assertBlocked('Agent 检测失败，请重新检测。');
  agentMode = 'ready';
  // Composer-specific action, distinct from the diagnostic panel's rescan.
  await panel.getByRole('button', { name: '重新检测', exact: true }).last().click();
  await page.waitForFunction(() => !document.querySelector('button[aria-label=发送消息]').disabled);
  await refreshFromSettings('unauthenticated');
  await assertBlocked('当前 Agent 尚未登录，请查看配置指引。');
  await refreshFromSettings('hold');
  await assertBlocked('正在检测 Agent，请稍候。', { transient: true });
  agentMode = 'ready'; releaseDetection();
  await page.waitForFunction(() => !document.querySelector('button[aria-label=发送消息]').disabled);
  await input.fill('恢复后发送同一份草稿');
  await page.screenshot({ path: `${out}/ready.png` });
  await input.press('Enter');
  await page.waitForFunction(() => window.__agentRequests.length === 1);
  const request = await page.evaluate(() => window.__agentRequests[0]);
  assert.equal(request.text, '恢复后发送同一份草稿');
  assert.equal(request.images.length, 1);
  assert.equal(request.runtimeId, 'fixture-agent');
  assert.equal(await input.inputValue(), '');
  const stop = page.getByRole('button', { name: '停止本轮', exact: true });
  await stop.waitFor();
  // Losing the connection during a run must not replace/disable cancellation.
  online = false; sockets.at(-1).close({ code: 1001, reason: 'fixture disconnect' });
  await page.waitForFunction(() => document.querySelector('[data-board-connection]')?.dataset.boardConnection === 'disconnected');
  assert(await stop.isEnabled());
  assert.equal(await panel.getByText('画板未连接，连接后即可发送。', { exact: true }).count(), 0);
  await stop.click();
  await panel.getByText('画板未连接，连接后即可发送。', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await writeFile(`${out}/results.json`, JSON.stringify({ blockedStates: results, recoveredSend: true, stopAfterDisconnect: true, errors }, null, 2));
  console.log('PASS: disconnected/unusable/missing/detection failure/login/detecting preserve text + image; recovery sends once; stop remains usable.');
} finally {
  await browser.close();
}
