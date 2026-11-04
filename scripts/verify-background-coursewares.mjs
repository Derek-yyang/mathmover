import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Real independent GeoGebra instances and browser streams; all model, library
// and daemon requests are fixtures, so this never spends credits or edits data.
const out = 'spike-out/background-coursewares';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1544, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
const projectId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const now = new Date().toISOString();
const records = new Map(ids.map((id, i) => [id, { id, title: `课件${'ABC'[i]}`, revision: 1, titleSource: 'manual',
  created_at: now, updated_at: now, archived_at: null, project_id: i === 0 ? projectId : null,
  commands: [`${'ABC'[i]}=(${i + 1},2)`], messages: [] }]));
const projects = [{ id: projectId, name: '测试项目', revision: 1, created_at: now, updated_at: now }];
const errors = [], writes = [], sockets = new Map(), pending = new Map();
let holdFinalB = false, releaseFinalB, failFinalA = false;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => {
  assert.equal(route.request().method(), 'GET');
  return route.fulfill({ json: { runtimes: [{ id: 'fixture', name: '测试 Agent', version: 'fixture', usable: true, canAttachImages: true }] } });
});
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false, baseUrl: '', model: '', apiFormat: 'openai-chat', reasoningLevels: '' } }));
await page.route('**/api/coursewares**', async route => {
  const req = route.request(), url = new URL(req.url()), parts = url.pathname.split('/').slice(3);
  if (parts[0] === 'windows') return route.fulfill({ json: { bindingToken: 'fixture' } });
  if (req.method() === 'GET') return route.fulfill({ json: parts.length ? records.get(parts[0])
    : { records: [...records.values()], projects, capabilities: { organization: true, archive: true, permanentDelete: true } } });
  const body = req.postDataJSON(); writes.push({ path: url.pathname, body });
  if (parts[0] === 'delete') {
    assert(!body.ids.includes(ids[0]), 'running A is never included in a delete');
    body.ids.forEach(id => records.delete(id));
    return route.fulfill({ json: { ok: true } });
  }
  if (parts.length) {
    const record = records.get(parts[0]);
    if (parts[1] === 'organize') {
      if ('pinned' in body) record.pinned_at = body.pinned ? now : null;
      if ('projectId' in body) record.project_id = body.projectId;
    } else {
      assert.equal(body.expectedRevision, record.revision, 'metadata uses the current revision');
      record.revision++;
      if (parts[1] === 'rename') record.title = body.title;
      else record.archived_at = parts[1] === 'archive' ? now : null;
    }
    return route.fulfill({ json: record });
  }
  const previous = records.get(body.id);
  if (holdFinalB && body.id === ids[1] && body.messages.at(-1)?.content === 'B 已完成') {
    holdFinalB = false;
    await new Promise(resolve => { releaseFinalB = resolve; });
  }
  if (failFinalA && body.id === ids[0] && body.messages.at(-1)?.content === 'A 的后台最终回答') {
    return route.fulfill({ status: 503, json: { error: '最终保存失败测试' } });
  }
  assert.equal(body.expectedRevision, previous?.revision ?? 0, 'autosave stays in its own revision queue');
  const next = { ...previous, ...body, revision: (previous?.revision ?? 0) + 1 };
  records.set(body.id, next);
  return route.fulfill({ json: next });
});
await page.routeWebSocket('ws://127.0.0.1:8787', socket => {
  let windowId;
  socket.onMessage(raw => {
    const data = JSON.parse(String(raw));
    if (data.type === 'hello') { windowId = data.windowId; sockets.set(windowId, socket); }
    else if (pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
  });
  socket.onClose(() => sockets.delete(windowId));
});
const call = (windowId, op, args) => new Promise((resolve, reject) => {
  const id = crypto.randomUUID();
  const timeout = setTimeout(() => reject(new Error(`bridge ${op} timed out`)), 30000);
  pending.set(id, result => { clearTimeout(timeout); result.error ? reject(new Error(result.error)) : resolve(result.payload); });
  assert(sockets.has(windowId), 'original workspace bridge remains connected');
  sockets.get(windowId).send(JSON.stringify({ id, op, args }));
});
await page.addInitScript(() => {
  localStorage.setItem('mm.agentId', 'fixture');
  window.__runs = {};
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (new URL(String(input), location.href).pathname === '/api/agent' && init?.method === 'POST') {
      const request = JSON.parse(init.body);
      const run = { request, aborted: false };
      window.__runs[request.coursewareId] = run;
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        run.emit = events => events.forEach(event => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n')));
        run.finish = () => controller.close();
        init.signal.addEventListener('abort', () => { run.aborted = true; controller.error(new DOMException('Stopped', 'AbortError')); }, { once: true });
      } }), { headers: { 'content-type': 'application/x-ndjson' } }));
    }
    return original(input, init);
  };
});
const active = () => page.locator('[data-slot=courseware-workspace][data-active=true]');
const list = page.getByRole('complementary', { name: '课件侧栏', exact: true });
const row = title => list.locator('[data-slot=aui_thread-list-item-trigger]').filter({ hasText: title }).first();
const menuButton = title => row(title).locator('..').getByRole('button', { name: '课件操作', exact: true });
const menu = async title => { await row(title).locator('..').hover(); await menuButton(title).click(); };
const waitBoard = name => page.waitForFunction(name => window.ggbApplet?.exists?.(name), name);
const switchTo = async (title, name) => { await row(title).click(); await waitBoard(name); };
const start = async text => {
  await active().getByRole('textbox', { name: '题目描述', exact: true }).fill(text);
  await active().getByRole('button', { name: '发送消息', exact: true }).click();
  await active().getByRole('button', { name: '停止本轮', exact: true }).waitFor();
};
const poll = async fn => {
  const end = Date.now() + 20000;
  while (!fn() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 50));
  assert(fn());
};
const finish = async (id, text) => page.evaluate(({ id, text }) => {
  const run = window.__runs[id];
  run.emit([{ kind: 'text', phase: 'final', messageId: 'final', text }, { kind: 'done', resultText: text }]);
  run.finish();
}, { id, text });
try {
  await stubConstructionDraft(page);
  await page.goto(`${process.argv[2] || 'http://localhost:3000'}/dashboard?history_id=${ids[0]}`);
  await waitBoard('A');
  await page.addStyleTag({ content: 'nextjs-portal {display:none!important}' });
  await start('生成 A');
  await page.waitForFunction(id => !!window.__runs[id], ids[0]);
  const requestA = await page.evaluate(id => window.__runs[id].request, ids[0]);
  await page.evaluate(() => { window.__apiA = window.ggbApplet; });
  assert(await menuButton('课件A').isDisabled(), 'running courseware metadata is protected');
  await switchTo('课件B', 'B');
  assert.equal(context.pages().length, 1, 'switching never opens another tab');
  assert.equal(await page.evaluate(id => window.__runs[id].aborted, ids[0]), false);
  assert.equal(await page.locator('[data-slot=courseware-workspace]').count(), 2, 'running editor stays mounted');
  assert(await menuButton('课件B').isEnabled());
  assert(await menuButton('课件A').isDisabled(), 'background A remains protected');
  const result = await call(requestA.windowId, 'apply', { commands: ['R=(7,8)'], incremental: true, ledger: ['A=(1,2)', 'R=(7,8)'] });
  assert(result.state.names.includes('R'));
  assert.equal(await page.evaluate(() => window.ggbApplet.exists('R')), false, 'background tools never write to the visible B canvas');
  await page.evaluate(() => {
    window.__nativePngA = window.__apiA.getPNGBase64;
    window.__apiA.getPNGBase64 = () => '';
  });
  const fallback = await call(requestA.windowId, 'getState');
  assert.equal(fallback.pngSource, 'canvas-to-data-url');
  assert.equal(fallback.png, await page.evaluate(id => document.querySelector(`[data-courseware-id="${id}"] .GeoGebraFrame canvas`).toDataURL('image/png').split(',')[1], ids[0]), 'PNG fallback captures the original background canvas');
  await page.evaluate(() => { window.__apiA.getPNGBase64 = window.__nativePngA; });
  await active().getByRole('textbox', { name: '题目描述', exact: true }).fill('B 的未发送草稿');
  await switchTo('课件A', 'R');
  await active().getByRole('button', { name: '停止本轮', exact: true }).waitFor();
  await switchTo('课件B', 'B');
  assert.equal(await active().getByRole('textbox', { name: '题目描述', exact: true }).inputValue(), 'B 的未发送草稿');
  await menu('课件C'); await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const rename = list.getByRole('textbox', { name: '课件名称', exact: true });
  await rename.fill('其他课件'); await rename.press('Enter'); await row('其他课件').waitFor();
  await menu('其他课件'); await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
  await poll(() => !!records.get(ids[2]).pinned_at);
  await menu('其他课件'); await page.getByRole('menuitem', { name: '移动到项目', exact: true }).click();
  await page.getByRole('dialog', { name: '移动到项目', exact: true }).getByRole('button', { name: '测试项目', exact: true }).click();
  await poll(() => records.get(ids[2]).project_id === projectId);
  await menu('其他课件'); await page.getByRole('menuitem', { name: '归档', exact: true }).click();
  await poll(() => !!records.get(ids[2]).archived_at);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '归档课件', exact: true }).click();
  const archiveList = page.locator('[data-slot=settings-dialog]');
  await archiveList.getByRole('button', { name: '课件操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '取消归档', exact: true }).click();
  await poll(() => !records.get(ids[2]).archived_at);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await menu('其他课件'); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await poll(() => !records.has(ids[2]));
  assert(records.has(ids[0]));
  await list.getByRole('button', { name: '新建课件', exact: true }).click();
  await active().getByRole('textbox', { name: '题目描述', exact: true }).waitFor();
  await page.waitForFunction(() => window.ggbApplet?.exists && !window.ggbApplet.exists('B') && !window.ggbApplet.exists('A'));
  assert.equal(context.pages().length, 1, 'new courseware also stays in the current tab');
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.getByRole('button', { name: '新建课件', exact: true }).click();
  await page.waitForURL(url => !url.searchParams.has('history_id') && !url.searchParams.has('action'));
  assert.equal(context.pages().length, 1, 'collapsed-rail creation also stays in the current tab');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await switchTo('课件B', 'B');
  await start('同时生成 B');
  await page.waitForFunction(id => !!window.__runs[id], ids[1]);
  const requestB = await page.evaluate(id => window.__runs[id].request, ids[1]);
  assert.notEqual(requestB.windowId, requestA.windowId, 'runs bind independent daemon identities');
  assert(await menuButton('课件A').isDisabled()); assert(await menuButton('课件B').isDisabled());
  holdFinalB = true;
  await finish(ids[1], 'B 已完成');
  await poll(() => !!releaseFinalB);
  assert(await menuButton('课件B').isDisabled(), 'the guard covers the pending final save');
  releaseFinalB();
  await poll(() => records.get(ids[1]).messages.at(-1)?.content === 'B 已完成');
  await poll(() => !!records.get(ids[1]).ggbBase64);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-slot=aui_thread-list-item]')]
    .some(row => row.textContent.includes('课件B') && !row.querySelector('[data-slot=aui_thread-list-item-more]').disabled));
  assert(await menuButton('课件A').isDisabled(), 'finishing B does not unlock running A');
  failFinalA = true;
  await finish(ids[0], 'A 的后台最终回答');
  await page.getByRole('alert').filter({ hasText: '后台课件保存失败' }).waitFor();
  assert(await menuButton('课件A').isDisabled(), 'a failed final save keeps the original courseware protected');
  assert.equal(await page.locator('[data-slot=courseware-workspace]').count(), 2, 'unsaved background state stays mounted');
  await page.getByRole('button', { name: '返回查看', exact: true }).click();
  await active().getByText('A 的后台最终回答', { exact: true }).waitFor();
  failFinalA = false;
  await active().getByRole('alert').getByRole('button', { name: '重试', exact: true }).click();
  await poll(() => records.get(ids[0]).messages.at(-1)?.content === 'A 的后台最终回答' && records.get(ids[0]).commands.includes('R=(7,8)'));
  await page.waitForFunction(() => [...document.querySelectorAll('[data-slot=aui_thread-list-item]')]
    .some(row => row.textContent.includes('课件A') && !row.querySelector('[data-slot=aui_thread-list-item-more]').disabled));
  await switchTo('课件B', 'B');
  await page.waitForFunction(() => document.querySelectorAll('[data-slot=courseware-workspace]').length === 1);
  assert(new URL(page.url()).searchParams.get('history_id') === ids[1], 'background save never changes the active URL');
  assert(await active().getByText('B 已完成', { exact: true }).isVisible());
  await switchTo('课件A', 'R');
  await active().getByText('A 的后台最终回答', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.ggbApplet.getXcoord('R')), 7, 'completed background snapshot restores its own board');
  assert.equal(await page.evaluate(id => window.__runs[id].aborted, ids[0]), false);
  await switchTo('课件B', 'B');
  await start('再生成 B');
  await page.waitForFunction(id => window.__runs[id].request.text === '再生成 B', ids[1]);
  await switchTo('课件A', 'R');
  await finish(ids[1], 'B 的后台最终回答');
  await poll(() => records.get(ids[1]).messages.at(-1)?.content === 'B 的后台最终回答');
  await page.waitForFunction(() => document.querySelectorAll('[data-slot=courseware-workspace]').length === 1);
  assert.equal(new URL(page.url()).searchParams.get('history_id'), ids[0], 'normal background completion preserves the selected URL');
  assert(await active().getByText('A 的后台最终回答', { exact: true }).isVisible(), 'background completion preserves the selected answer');
  await page.screenshot({ path: `${out}/completed-background.png` });
  assert.deepEqual(errors, []);
  await writeFile(`${out}/results.json`, JSON.stringify({ passed: true, independentWindows: [requestA.windowId, requestB.windowId],
    scenarios: ['same-tab switching', 'background tool isolation', 'return to running stream', 'draft preservation', 'rename/pin/move/archive/delete other coursewares',
      'running record protection', 'same-tab new', 'concurrent run guards', 'final autosave', 'pending/failed final save protection', 'background save failure recovery',
      'background PNG fallback isolation', 'background resource disposal', 'snapshot restore'], writes: writes.length }, null, 2));
  console.log('PASS: background courseware isolation, metadata actions, parallel guards, autosave and restore.');
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` });
  console.log('Page errors:', errors);
  console.log(await page.locator('[data-slot=dashboard-root]').allTextContents());
  throw error;
} finally { await browser.close(); }
