import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Actual pages/canvases; no model calls, real database writes or daemon messages.
const out = 'spike-out/new-courseware-during-run';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors = [], agentRequests = [], connections = new Map(), replies = new Map();
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = new Date().toISOString();
const records = new Map([[id, { id, title: '运行中的原课件', revision: 1, archived_at: null,
  created_at: now, updated_at: now, messages: [], commands: ['A=(1,2)'], view: { showAxes: true, showGrid: true } }]]);
await context.addInitScript(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (new URL(String(input), location.href).pathname === '/api/agent' && init?.method === 'POST') {
      window.__fixtureRun = { request: JSON.parse(init.body), aborted: false };
      const stream = new ReadableStream({ start(controller) {
        window.__fixtureRun.controller = controller;
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ kind: 'text-delta', text: '正在绘制本课件。' }) + '\n'));
        init.signal.addEventListener('abort', () => {
          window.__fixtureRun.aborted = true;
          controller.error(new DOMException('Stopped', 'AbortError'));
        }, { once: true });
      } });
      return Promise.resolve(new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } }));
    }
    return originalFetch(input, init);
  };
});
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route('**/api/agent**', route => {
  assert.equal(route.request().method(), 'GET', 'real Agent POST must be intercepted in-page');
  return route.fulfill({ json: { runtimes: [{ id: 'claude-code', name: 'Claude Code', version: 'fixture', usable: true }] } });
});
await context.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await context.route('**/api/coursewares**', route => {
  const req = route.request(), url = new URL(req.url());
  if (url.pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture-ticket' } });
  if (req.method() === 'GET') return route.fulfill({ json: url.pathname === '/api/coursewares' ? { records: [...records.values()], capabilities: { archive: true, permanentDelete: true } } : records.get(url.pathname.split('/').at(-1)) });
  assert.equal(url.pathname, '/api/coursewares', 'only fixture autosaves allowed');
  assert.equal(req.method(), 'POST');
  const body = req.postDataJSON(), previous = records.get(body.id);
  assert.equal(body.expectedRevision, previous?.revision ?? 0);
  const next = { ...previous, ...body, revision: (previous?.revision ?? 0) + 1 };
  records.set(next.id, next);
  return route.fulfill({ json: next });
});
await context.routeWebSocket('ws://127.0.0.1:8787', socket => {
  socket.onMessage(raw => {
    const message = JSON.parse(String(raw));
    if (message.type === 'hello') connections.set(message.windowId, socket);
    else if (message.id) replies.set(message.id, message);
  });
});
const page = await context.newPage();
const newButton = page => page.getByRole('button', { name: '新建课件', exact: true });
const input = page => page.getByRole('textbox', { name: '题目描述' });
const stop = page => page.getByRole('button', { name: '停止本轮', exact: true });
const ready = async page => {
  await page.waitForFunction(() => typeof window.ggbApplet?.getAllObjectNames === 'function');
  await page.waitForFunction(() => document.querySelector('[data-board-connection]')?.getAttribute('data-board-connection') === 'connected');
  await page.addStyleTag({ content: 'nextjs-portal { display:none !important; }' });
};
const send = async (page, text) => {
  await input(page).fill(text);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.waitForFunction(() => !!window.__fixtureRun?.controller);
  await stop(page).waitFor();
  const request = await page.evaluate(() => window.__fixtureRun.request);
  agentRequests.push(request); return request;
};
const finish = async (page, marker) => {
  await page.evaluate(marker => {
    const controller = window.__fixtureRun.controller;
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ kind: 'text-delta', text: marker }) + '\n' + JSON.stringify({ kind: 'done', sessionId: marker }) + '\n'));
    controller.close();
  }, marker);
  await stop(page).waitFor({ state: 'detached' });
  for (let i = 0; i < 200; i++) {
    if ([...records.values()].some(record => record.messages.some(message => message.content.includes(marker)))) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail('finished messages must reach fixture storage');
};
const apply = async (windowId, commands) => {
  const requestId = crypto.randomUUID();
  assert(connections.has(windowId), 'each Agent targets a connected page');
  connections.get(windowId).send(JSON.stringify({ id: requestId, op: 'apply', args: { commands, incremental: true, ledger: commands } }));
  for (let i = 0; i < 100 && !replies.has(requestId); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert(replies.has(requestId), 'canvas replies to bridge request');
  assert.equal(replies.get(requestId).error, undefined);
};
try {
  await page.goto((process.argv[2] || 'http://localhost:3000') + '/dashboard?history_id=' + id);
  await ready(page); await page.waitForFunction(() => window.ggbApplet.exists('A'));
  const originalUrl = page.url(), original = await send(page, '旧课件任务');
  assert(await newButton(page).isEnabled());
  const popupPromise = context.waitForEvent('page');
  await newButton(page).click();
  const fresh = await popupPromise;
  await fresh.waitForURL(/\/dashboard(?:\?action=new)?$/); await ready(fresh);
  await fresh.waitForFunction(() => document.querySelector('button[aria-label="发送消息"]')?.disabled === true);
  assert.equal(await fresh.evaluate(() => window.opener), null, 'new tab has no opener');
  assert.equal(await fresh.evaluate(() => window.ggbApplet.getAllObjectNames().length), 0, 'new canvas starts blank');
  assert.equal(await input(fresh).inputValue(), '', 'new composer starts blank');
  assert.equal(page.url(), originalUrl, 'original page stays on its courseware');
  assert(await stop(page).isVisible(), 'original run continues');
  assert.equal(await page.evaluate(() => window.__fixtureRun.aborted), false);
  assert(await page.evaluate(() => window.ggbApplet.exists('A')), 'original construction preserved');

  // Collapsed rail uses the same behavior and opens exactly one additional page.
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.waitForTimeout(350);
  const railPopup = context.waitForEvent('page'); await newButton(page).click();
  const another = await railPopup; await ready(another);
  assert.equal(context.pages().length, 3, 'each click opens exactly one page');
  assert.equal(await another.evaluate(() => window.ggbApplet.getAllObjectNames().length), 0);
  await another.close();

  // Both pages run independently; addressed bridge commands never cross canvases.
  const newRun = await send(fresh, '新课件任务');
  assert.notEqual(original.windowId, newRun.windowId);
  assert.equal(newRun.sessionId, undefined, 'new Agent does not resume the old session');
  await apply(original.windowId, ['B=(3,4)']);
  await page.waitForFunction(() => window.ggbApplet.exists('B'));
  assert.equal(await fresh.evaluate(() => window.ggbApplet.exists('B')), false);
  await apply(newRun.windowId, ['C=(5,6)']);
  await fresh.waitForFunction(() => window.ggbApplet.exists('C'));
  assert.equal(await page.evaluate(() => window.ggbApplet.exists('C')), false);
  await finish(page, '旧任务完成'); await finish(fresh, '新任务完成');
  assert(records.get(id).messages.some(message => message.content.includes('旧任务完成')));
  assert(!records.get(id).messages.some(message => message.content.includes('新任务完成')));
  const newRecord = [...records.values()].find(record => record.id !== id);
  assert(newRecord?.messages.some(message => message.content.includes('新任务完成')));
  assert(!newRecord.messages.some(message => message.content.includes('旧任务完成')));
  await page.screenshot({ path: out + '/original-finished.png' });
  await fresh.screenshot({ path: out + '/new-finished.png' });

  // Idle new stays in the current page, flushes its saved courseware and clears the canvas.
  const pagesBefore = context.pages().length;
  await newButton(page).click();
  await page.waitForURL(/\/dashboard$/);
  await page.waitForFunction(() => window.ggbApplet.getAllObjectNames().length === 0);
  assert.equal(context.pages().length, pagesBefore);
  assert.equal(await input(page).inputValue(), '');
  assert.deepEqual(errors, []);
  const result = { ok: true, expandedAndCollapsedOpenNewTab: true, originalRunContinues: true,
    independentWindowIds: true, targetedCanvasCommandsIsolated: true, savedMessagesIsolated: true,
    idleNewUsesSameTab: true, pageErrors: errors };
  await writeFile(out + '/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }

