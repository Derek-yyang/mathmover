import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Real dashboard/canvas; all courseware reads and writes use in-memory fixtures.
const out = 'spike-out/courseware-title';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1544, height: 900 } });
const page = await context.newPage();
const base = process.argv[2] || 'http://localhost:3000';
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const make = (id, title, commands) => ({ id, title, commands, messages: [], revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), view: { showAxes: true, showGrid: true } });
const records = new Map([make(first, '抛物线研究', ['A=(1,2)']), make(second, '圆的性质', ['B=(3,4)'])].map(record => [record.id, record]));
const writes = [], errors = [];
let failRename = false, failSave = false, holdSave = false, releaseSave;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [{ id: 'claude-code', name: 'Claude Code', version: 'fixture', usable: true }] } }));
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.route('**/api/coursewares**', async route => {
  const request = route.request(), url = new URL(request.url());
  const parts = url.pathname.split('/').slice(3);
  if (parts[0] === 'windows') return route.fulfill({ json: { ok: true } });
  if (request.method() === 'GET') return route.fulfill({ json: parts.length ? records.get(parts[0]) : { records: [...records.values()], capabilities: { archive: true, permanentDelete: true } } });
  const body = request.postDataJSON();
  writes.push({ path: url.pathname, body });
  if (parts[1] === 'rename') {
    if (failRename) return route.fulfill({ status: 503, json: { error: '重命名失败测试' } });
    const current = records.get(parts[0]);
    assert.equal(body.expectedRevision, current.revision, 'rename uses the latest saved revision');
    const next = { ...current, title: body.title, revision: current.revision + 1 };
    records.set(next.id, next);
    return route.fulfill({ json: next });
  }
  assert.equal(url.pathname, '/api/coursewares', 'no other mutations are allowed');
  if (holdSave) { holdSave = false; await new Promise(resolve => { releaseSave = resolve; }); }
  if (failSave) return route.fulfill({ status: 503, json: { error: '首次保存失败测试' } });
  const current = records.get(body.id);
  assert.equal(body.expectedRevision, current?.revision ?? 0, 'autosave uses the latest revision');
  const next = { ...current, ...body, revision: (current?.revision ?? 0) + 1, archived_at: current?.archived_at ?? null };
  records.set(next.id, next);
  return route.fulfill({ json: next });
});
const name = page.getByRole('textbox', { name: '课件名称', exact: true });
const title = () => page.getByRole('button', { name: /^重命名课件：/ });
const sidebar = page.locator('aside[aria-label=课件侧栏]');
const row = text => sidebar.locator('[data-slot=aui_thread-list-item-trigger]').filter({ hasText: text });
const ready = async () => { await page.waitForFunction(() => typeof window.ggbApplet?.getAllObjectNames === 'function'); await title().waitFor(); await page.waitForFunction(() => !document.querySelector('button[aria-label^="重命名课件："]')?.disabled); };
const open = async () => { await title().click(); await name.waitFor(); };
const saved = async text => { await page.getByRole('button', { name: `重命名课件：${text}`, exact: true }).waitFor(); await row(text).waitFor(); };
const submit = async text => { await open(); await name.fill(text); await name.press('Enter'); await saved(text); };
try {
  await page.goto(`${base}/dashboard?history_id=${first}`);
  await ready();
  await page.addStyleTag({ content: 'nextjs-portal {display:none !important;}' });
  await page.waitForFunction(() => window.ggbApplet.exists('A'));
  // Existing records rename without regenerating the canvas snapshot.
  await page.evaluate(() => {
    const api = window.ggbApplet, original = api.getBase64.bind(api);
    window.__titleCaptures = 0;
    api.getBase64 = (...args) => { window.__titleCaptures++; return original(...args); };
  });
  await open();
  assert(await name.evaluate(element => document.activeElement === element && element.selectionStart === 0 && element.selectionEnd === element.value.length));
  await name.fill('  新的课件名称  ');
  await page.screenshot({ path: `${out}/editing.png` });
  await name.press('Enter'); await saved('新的课件名称');
  assert.equal(records.get(first).title, '新的课件名称');
  assert.equal(await page.evaluate(() => window.__titleCaptures), 0);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '重命名课件：新的课件名称');
  let before = writes.length;
  await open(); await name.fill('取消的名称'); await name.press('Escape'); await saved('新的课件名称');
  assert.equal(writes.length, before, 'Escape does not save');
  await open(); await name.press('Enter');
  await saved('新的课件名称'); assert.equal(writes.length, before, 'unchanged title does not save');
  await open(); await name.fill('   '); await name.press('Enter');
  await page.getByRole('alert').filter({ hasText: '请输入课件名称' }).waitFor();
  assert.equal(writes.length, before, 'empty title does not save');
  await name.fill('中文输入测试');
  assert(await name.evaluate(element => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
    element.dispatchEvent(event); return event.defaultPrevented;
  }), 'IME confirmation does not submit');
  assert.equal(writes.length, before);
  await name.press('Escape');
  await saved('新的课件名称'); assert.equal(writes.length, before, 'Escape does not trigger blur save');
  // Blur commits without stealing focus from the next control.
  await open(); await name.fill('失焦保存的名称');
  const exportButton = page.getByRole('button', { name: '导出', exact: true });
  await exportButton.focus(); await saved('失焦保存的名称');
  assert(await exportButton.evaluate(element => document.activeElement === element));
  // Failed rename preserves the editable draft and can be retried.
  failRename = true; await open(); await name.fill('重试后的名称'); await name.press('Enter');
  await page.getByRole('alert').filter({ hasText: '重命名失败测试' }).waitFor();
  assert.equal(await name.inputValue(), '重试后的名称'); assert.equal(records.get(first).title, '失焦保存的名称');
  failRename = false; await name.press('Enter'); await saved('重试后的名称');
  // Autosave already in flight must finish before renaming.
  holdSave = true;
  const snapshotRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/coursewares');
  await page.evaluate(() => window.ggbApplet.setCoords('A', 2, 3));
  await snapshotRequest;
  while (!releaseSave) await new Promise(resolve => setTimeout(resolve, 20));
  before = writes.filter(write => write.path.endsWith('/rename')).length;
  await open(); await name.fill('与自动保存串行'); await name.press('Enter');
  await page.waitForFunction(() => document.querySelector('input[aria-label="课件名称"]')?.readOnly);
  await name.press('Enter');
  assert.equal(writes.filter(write => write.path.endsWith('/rename')).length, before, 'rename waits for snapshot save');
  releaseSave(); releaseSave = null;
  await saved('与自动保存串行');
  assert.equal(writes.filter(write => write.path.endsWith('/rename')).length, before + 1, 'duplicate Enter produces one rename');
  const nextSnapshot = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/coursewares');
  await page.evaluate(() => window.ggbApplet.setCoords('A', 4, 5));
  await nextSnapshot; assert.equal(records.get(first).title, '与自动保存串行');
  // Fullscreen editing keeps the menu-free lightweight form inside the workspace.
  await page.getByRole('button', { name: '全屏演示', exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await submit('全屏编辑成功');
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.evaluate(() => { HTMLElement.prototype.requestFullscreen = async () => { throw new Error('fixture fallback'); }; });
  await page.getByRole('button', { name: '全屏演示', exact: true }).click();
  await open(); await name.fill('演示中取消'); await name.press('Escape'); await saved('全屏编辑成功');
  assert(await page.getByRole('button', { name: '退出全屏', exact: true }).isVisible(), 'editing Escape preserves presentation');
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await row('圆的性质').click(); await ready(); await saved('圆的性质');
  await submit('第二个课件'); assert.equal(records.get(first).title, '全屏编辑成功');
  await page.reload(); await ready(); await saved('第二个课件');
  // A named empty new courseware persists; failed initial save retries as a save, not rename of a nonexistent ID.
  await sidebar.getByRole('button', { name: '新建课件', exact: true }).click(); await ready();
  await page.getByRole('button', { name: '重命名课件：未命名课件', exact: true }).waitFor();
  await page.waitForFunction(() => window.ggbApplet.getAllObjectNames().length === 0);
  failSave = true; await open(); await name.fill('空白课件自定义名'); await name.press('Enter');
  await page.getByRole('alert').filter({ hasText: '首次保存失败测试' }).first().waitFor();
  failSave = false; await name.press('Enter');
  await saved('空白课件自定义名'); await page.waitForURL(/history_id=/);
  const newId = new URL(page.url()).searchParams.get('history_id');
  assert.equal(records.get(newId).title, '空白课件自定义名');
  assert.equal(records.get(newId).messages.length, 0); assert.equal(records.get(newId).commands.length, 0);
  await page.reload(); await ready(); await saved('空白课件自定义名');
  await page.setViewportSize({ width: 974, height: 768 }); await open();
  const box = await name.boundingBox(); assert(box.width > 30 && box.x >= 0 && box.x + box.width < 974);
  await page.screenshot({ path: `${out}/narrow-editing.png` });
  await name.press('Escape');
  assert.deepEqual(errors, []);
  await writeFile(`${out}/result.json`, JSON.stringify({ ok: true, pageErrors: errors, writes: writes.map(write => ({ path: write.path, title: write.body.title, expectedRevision: write.body.expectedRevision })), scenarios: ['inline edit', 'Enter/Escape/focus', 'blur save', 'empty validation', 'IME', 'failure/retry', 'queued autosave and duplicate Enter', 'fullscreen/presentation', 'switch and reload', 'named blank first save/retry', 'narrow viewport'] }, null, 2));
  console.log('Courseware title regression passed; fixture writes only.');
} catch (error) {
  releaseSave?.();
  await page.screenshot({ path: `${out}/failure.png` });
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: error.message, errors, writes: writes.map(write => ({ path: write.path, title: write.body.title, expectedRevision: write.body.expectedRevision })) }, null, 2));
  throw error;
} finally { await browser.close(); }
