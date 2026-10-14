import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Real dashboard and GeoGebra, with isolated in-memory courseware API fixtures.
const base = process.argv[2] || 'http://localhost:3000';
const out = new URL('../spike-out/thread-list-integration/', import.meta.url);
await mkdir(out, { recursive: true });
const output = name => new URL(name, out).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
const make = (id, title, days, commands) => {
  const date = new Date(today); date.setDate(date.getDate() - days);
  return { id, title, created_at: date.toISOString(), updated_at: date.toISOString(), archived_at: null,
    revision: 1, commands, messages: [{ id: `${id}-u`, role: 'user', content: `请绘制${title}`, createdAt: date.getTime() },
      { id: `${id}-a`, role: 'assistant', content: `${title}已恢复`, createdAt: date.getTime(), meta: { status: 'completed' } }],
    view: { showAxes: true, showGrid: true } };
};
const firstId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const thirdId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const records = new Map([
  make(firstId, '抛物线研究', 0, ['A=(1,2)']),
  make(secondId, '圆的性质', 1, ['B=(3,4)']),
  make(thirdId, '三角函数', 8, ['C=(5,6)']),
].map(record => [record.id, record]));
let failList = false, failRename = false, failDelete = false, failArchive = false, legacyService = false, slowDelete = false;
const writes = [];
const errors = [];
const context = await browser.newContext({ viewport: { width: 1544, height: 900 } });
const page = await context.newPage();
await page.addInitScript(() => {
  window.__focusEvents = [];
  for (const type of ['keydown', 'focusout', 'focusin']) document.addEventListener(type, event => {
    const slot = event.target?.getAttribute?.('data-slot');
    if (slot?.includes('thread-list')) window.__focusEvents.push({ type, slot, key: event.key });
  }, true);
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (new URL(String(input), location.href).pathname === '/api/agent' && init?.method === 'POST') {
      const stream = new ReadableStream({ start(controller) {
        init.signal.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), { once: true });
      } });
      return Promise.resolve(new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } }));
    }
    return originalFetch(input, init);
  };
});
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [{ id: 'claude-code', name: 'Claude Code', version: 'fixture', usable: true, authStatus: 'ok', canAttachImages: true }] } }));
await page.route('**/api/coursewares**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const parts = url.pathname.split('/').slice(3);
  if (parts[0] === 'windows') return route.fulfill({ json: { ok: true } });
  if (request.method() === 'GET') {
    if (!parts.length) {
      if (failList) return route.fulfill({ status: 503, json: { error: '列表读取失败测试' } });
      return route.fulfill({ json: { records: [...records.values()].filter(record => url.searchParams.get('archived') === 'all' || (url.searchParams.get('archived') === '1' ? record.archived_at : !record.archived_at)), dataDirectory: 'fixture', capabilities: legacyService ? undefined : { archive: true, permanentDelete: true } } });
    }
    return route.fulfill({ json: records.get(parts[0]) });
  }
  const body = request.postDataJSON(); writes.push({ path: url.pathname, body });
  if (parts[0] === 'delete') {
    if (slowDelete) await new Promise(resolve => setTimeout(resolve, 1000));
    if (failDelete) return route.fulfill({ status: 503, json: { error: '删除失败测试' } });
    for (const id of body.ids) records.delete(id);
    return route.fulfill({ json: { ok: true } });
  }
  if (parts[1] === 'rename') {
    if (failRename) return route.fulfill({ status: 409, json: { error: '重命名冲突测试' } });
    const record = records.get(parts[0]);
    assert.equal(body.expectedRevision, record.revision);
    Object.assign(record, { title: body.title, revision: record.revision + 1 });
    return route.fulfill({ json: record });
  }
  if (parts[1] === 'archive' || parts[1] === 'unarchive') {
    if (failArchive) return route.fulfill({ status: 409, json: { error: '归档冲突测试' } });
    const record = records.get(parts[0]);
    assert.equal(body.expectedRevision, record.revision);
    Object.assign(record, { archived_at: parts[1] === 'archive' ? new Date().toISOString() : null, revision: record.revision + 1 });
    return route.fulfill({ json: record });
  }
  const current = records.get(body.id);
  if (current) assert.equal(body.expectedRevision, current.revision);
  const next = { ...current, ...body, archived_at: current?.archived_at ?? null, revision: (current?.revision ?? 0) + 1 };
  records.set(next.id, next);
  return route.fulfill({ json: next });
});
const recentList = page.locator('aside[aria-label=课件侧栏] [data-slot=aui_thread-list-root]');
const list = recentList;
const archiveList = page.locator('dialog[aria-labelledby=settings-title] [data-slot=aui_thread-list-root]');
let visibleList = recentList;
const rows = () => visibleList.locator('[data-slot=aui_thread-list-item-trigger]');
const openArchives = async () => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '归档课件', exact: true }).click();
  visibleList = archiveList;
};
const closeArchives = async () => {
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  visibleList = recentList;
};
const row = title => rows().filter({ hasText: title });
const menu = async title => {
  const root = row(title).locator('..');
  await root.hover();
  await root.getByRole('button', { name: '课件操作', exact: true }).click();
};
const waitForBoard = (name, x) => page.waitForFunction(({ name, x }) => window.ggbApplet?.exists(name) && window.ggbApplet.getXcoord(name) === x, { name, x });
try {
  await page.goto(`${base}/dashboard?history_id=${firstId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Mocked error cases raise the dev indicator over the footer. Keep that
  // developer-only badge out of the product hit-testing; pageerrors still fail.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await row('抛物线研究').waitFor();
  await page.getByText('抛物线研究已恢复', { exact: true }).waitFor();
  await waitForBoard('A', 1);
  assert.equal(await rows().count(), 3);
  assert.deepEqual(await list.locator('[data-slot=aui_thread-list-group-label]').allTextContents(), ['今天', '昨天', '更早']);
  assert.equal(await list.locator('[data-active] [data-slot=aui_thread-list-item-trigger]').textContent(), '抛物线研究');
  await page.locator('aside[aria-label=课件侧栏]').screenshot({ path: output('sidebar.png') });
  const search = list.getByRole('searchbox', { name: '搜索课件标题' });
  await search.fill('圆'); assert.equal(await rows().count(), 1);
  await search.fill('不存在'); await list.getByText('没有找到匹配的课件', { exact: true }).waitFor();
  await search.fill('');
  await row('圆的性质').click();
  await page.getByText('圆的性质已恢复', { exact: true }).waitFor();
  await waitForBoard('B', 3);
  await page.getByText('已保存到本地', { exact: true }).waitFor();
  await row('抛物线研究').click();
  await page.getByText('抛物线研究已恢复', { exact: true }).waitFor();
  await waitForBoard('A', 1);
  await page.getByText('已保存到本地', { exact: true }).waitFor();
  await page.waitForFunction(() => !window.ggbApplet.exists('B'));
  assert(records.get(firstId).ggbBase64, 'round trip restores the saved complete canvas snapshot');
  await row('圆的性质').click();
  await page.getByText('圆的性质已恢复', { exact: true }).waitFor();
  await waitForBoard('B', 3);
  await page.getByText('已保存到本地', { exact: true }).waitFor();
  await menu('圆的性质');
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const rename = list.getByRole('textbox', { name: '课件名称' });
  await rename.fill('放弃此名称'); await rename.press('Escape');
  assert.equal(records.get(secondId).title, '圆的性质');
  await menu('圆的性质'); await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await rename.fill('圆的性质改名'); await rename.press('Enter');
  await row('圆的性质改名').waitFor();
  assert.equal(records.get(secondId).title, '圆的性质改名');
  failRename = true;
  await menu('圆的性质改名'); await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await rename.fill('失败名称'); await rename.press('Enter');
  await list.getByRole('alert').filter({ hasText: '重命名冲突测试' }).waitFor();
  assert.equal(await rename.count(), 1, 'failed rename stays editable');
  failRename = false; await rename.press('Escape');
  // Official primitive keyboard focus group, without changing the selected courseware.
  await row('圆的性质改名').focus(); await page.keyboard.press('ArrowUp');
  assert.equal(await row('抛物线研究').evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await row('抛物线研究').locator('..').getByRole('button', { name: '课件操作', exact: true }).evaluate(element => element === document.activeElement), true);
  await page.getByRole('textbox', { name: '题目描述' }).fill('测试运行期间会话保护');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '停止本轮', exact: true }).waitFor();
  assert(await list.getByRole('button', { name: '新建课件', exact: true }).isEnabled(), 'new courseware can open a separate tab during execution');
  assert(await row('抛物线研究').isDisabled());
  assert(await row('圆的性质改名').locator('..').getByRole('button', { name: '课件操作', exact: true }).isDisabled());
  await page.getByRole('button', { name: '停止本轮', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-slot=aui_thread-list-new]').disabled);
  failArchive = true;
  await menu('圆的性质改名'); await page.getByRole('menuitem', { name: '归档', exact: true }).click();
  await list.getByRole('alert').filter({ hasText: '归档冲突测试' }).waitFor();
  assert.equal(await rows().count(), 3);
  failArchive = false;
  await menu('圆的性质改名'); await page.getByRole('menuitem', { name: '归档', exact: true }).click();
  await row('圆的性质改名').waitFor({ state: 'detached' });
  assert(records.get(secondId).archived_at);
  assert.equal(await recentList.getByRole('button', { name: /^归档/ }).count(), 0, 'archive navigation lives in settings');
  await openArchives();
  await row('圆的性质改名').waitFor();
  assert.equal(await rows().count(), 1);
  const archiveSearch = archiveList.getByRole('searchbox', { name: '搜索归档课件', exact: true });
  await archiveSearch.fill('不存在');
  await archiveList.getByText('没有找到匹配的课件', { exact: true }).waitFor();
  await archiveSearch.fill('圆');
  await row('圆的性质改名').waitFor();
  await archiveSearch.fill('');
  await menu('圆的性质改名'); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  const archiveDeleteDialog = page.getByRole('dialog', { name: '删除这个课件？', exact: true });
  await archiveDeleteDialog.waitFor();
  assert(await archiveDeleteDialog.evaluate(element => element.closest('dialog[aria-labelledby=settings-title]') !== null), 'archive popover stays inside the native Settings dialog');
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-slot=aui_thread-list-item-delete-confirmation]');
    const dialog = panel?.closest('dialog[aria-labelledby=settings-title]');
    if (!panel || !dialog) return false;
    const box = panel.getBoundingClientRect(), bounds = dialog.getBoundingClientRect();
    return box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom;
  });
  await page.locator('dialog[aria-labelledby=settings-title]').screenshot({ path: output('archive-delete-popover.png') });
  await archiveDeleteDialog.getByRole('button', { name: '取消', exact: true }).click();
  assert(records.has(secondId), 'archive delete cancellation retains the courseware');
  await row('圆的性质改名').click();
  await page.locator('dialog[aria-labelledby=settings-title]').waitFor({ state: 'detached' });
  visibleList = recentList;
  assert(records.get(secondId).archived_at, 'opening the current archive does not unarchive it');
  await openArchives();
  await row('圆的性质改名').waitFor();
  await page.locator('dialog[aria-labelledby=settings-title]').screenshot({ path: output('archives.png') });
  // Edits/auto-save of the active archive must retain its state and new revision.
  const savedArchive = page.waitForResponse(response => new URL(response.url()).pathname === '/api/coursewares' && response.request().method() === 'POST' && response.request().postDataJSON().id === secondId);
  await page.evaluate(() => window.ggbApplet.setCoords('B', 7, 4));
  await savedArchive;
  assert(records.get(secondId).archived_at);
  await menu('圆的性质改名'); await page.getByRole('menuitem', { name: '取消归档', exact: true }).click();
  await row('圆的性质改名').waitFor({ state: 'detached' });
  assert.equal(records.get(secondId).archived_at, null);
  await closeArchives();
  await row('圆的性质改名').waitFor();
  // An inactive archive opens normally and keeps its archived state.
  await menu('三角函数'); await page.getByRole('menuitem', { name: '归档', exact: true }).click();
  await row('三角函数').waitFor({ state: 'detached' });
  await openArchives();
  await row('三角函数').click();
  await page.locator('dialog[aria-labelledby=settings-title]').waitFor({ state: 'detached' });
  visibleList = recentList;
  await waitForBoard('C', 5);
  await page.getByText('三角函数已恢复', { exact: true }).waitFor();
  await page.getByText('已保存到本地', { exact: true }).waitFor();
  assert(records.get(thirdId).archived_at);
  await openArchives();
  await menu('三角函数'); await page.getByRole('menuitem', { name: '取消归档', exact: true }).click();
  await row('三角函数').waitFor({ state: 'detached' });
  await closeArchives();
  await row('圆的性质改名').click();
  await page.getByText('已保存到本地', { exact: true }).waitFor();
  await menu('抛物线研究'); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  const singleDelete = page.locator('[data-slot=aui_thread-list-item-delete-confirmation]');
  await singleDelete.waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent.trim() === '取消' && document.activeElement.closest('[data-slot=aui_thread-list-item-delete-confirmation]'));
  assert.equal(await page.locator('[data-state=open]').evaluateAll(elements => elements.some(element => element.classList.contains('bg-black/80'))), false, 'single deletion has no global backdrop');
  const anchorBox = await row('抛物线研究').locator('..').getByRole('button', { name: '课件操作', exact: true }).boundingBox();
  const confirmationBox = await singleDelete.boundingBox();
  assert(Math.abs(confirmationBox.x - anchorBox.x - anchorBox.width - 6) < 3 && Math.abs(confirmationBox.y - anchorBox.y) < 3, 'confirmation is anchored beside the chosen row');
  assert(confirmationBox.width <= 250 && confirmationBox.height < 150, 'single confirmation is compact');
  await page.screenshot({ path: output('single-delete-popover.png') });
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await singleDelete.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.dataset.slot === 'aui_thread-list-item-more');
  assert.equal(await rows().count(), 3);
  const deletesBeforeDismissal = writes.filter(write => write.path.endsWith('/delete')).length;
  await menu('抛物线研究'); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await singleDelete.waitFor(); await page.keyboard.press('Escape'); await singleDelete.waitFor({ state: 'detached' });
  await menu('抛物线研究'); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await singleDelete.waitFor(); await search.click(); await singleDelete.waitFor({ state: 'detached' });
  assert(await search.evaluate(element => document.activeElement === element), 'outside dismissal preserves the clicked control focus');
  assert.equal(writes.filter(write => write.path.endsWith('/delete')).length, deletesBeforeDismissal, 'cancel/Escape/outside never delete');
  legacyService = true;
  const deletesBeforeLegacyCheck = writes.filter(write => write.path.endsWith('/delete')).length;
  await menu('抛物线研究'); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: '请重启 daemon' }).waitFor();
  assert.equal(writes.filter(write => write.path.endsWith('/delete')).length, deletesBeforeLegacyCheck, 'legacy soft deletion is never called');
  assert(records.has(firstId));
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  legacyService = false;
  failDelete = true;
  slowDelete = true;
  await menu('抛物线研究'); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  const beforeFailedDelete = writes.filter(write => write.path.endsWith('/delete')).length;
  await page.getByRole('button', { name: '确认删除', exact: true }).evaluate(element => { element.click(); element.click(); });
  await page.waitForFunction(() => document.querySelector('[data-slot=aui_thread-list-item-delete-confirmation]')?.getAttribute('aria-busy') === 'true');
  await page.keyboard.press('Escape'); assert(await singleDelete.isVisible(), 'pending deletion keeps confirmation visible');
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: '删除失败测试' }).waitFor();
  assert.equal(writes.filter(write => write.path.endsWith('/delete')).length, beforeFailedDelete + 1, 'duplicate confirmation sends one delete request');
  slowDelete = false;
  assert.equal(await rows().count(), 3);
  failDelete = false;
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await row('抛物线研究').waitFor({ state: 'detached' });
  assert.equal(records.has(firstId), false, 'deletion removes the record instead of marking trash');
  assert.equal(await rows().count(), 2);
  // Delete the last index too: exit providers must not reference a removed index.
  await menu('三角函数'); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await row('三角函数').waitFor({ state: 'detached' });
  assert.equal(await rows().count(), 1);
  await list.getByRole('button', { name: '选择', exact: true }).click();
  await row('圆的性质改名').click();
  await list.getByRole('button', { name: '删除所选课件', exact: true }).click();
  assert.equal(await singleDelete.count(), 0, 'selection mode retains the centered batch dialog');
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role=dialog]');
    if (!dialog) return false;
    const box = dialog.getBoundingClientRect();
    return Math.abs(box.x + box.width / 2 - innerWidth / 2) < 2 && Math.abs(box.y + box.height / 2 - innerHeight / 2) < 2;
  });
  assert(await page.locator('[data-state=open]').evaluateAll(elements => elements.some(element => element.classList.contains('bg-black/80'))), 'batch deletion retains its backdrop');
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await list.getByRole('status').filter({ hasText: '暂无课件' }).waitFor();
  assert.equal(await list.getByRole('searchbox').count(), 0, 'empty library hides search');
  assert.equal(await list.getByRole('button', { name: '选择', exact: true }).count(), 0, 'empty library hides batch selection');
  await page.locator('aside[aria-label=课件侧栏]').screenshot({ path: output('empty-sidebar.png') });
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('history_id') && window.ggbApplet?.getAllObjectNames().length === 0);
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await list.getByRole('button', { name: '新建课件', exact: true }).click();
  await page.waitForURL(`${base}/dashboard`);
  failList = true;
  await page.evaluate(() => window.dispatchEvent(new Event('mathmover_coursewares_changed')));
  await list.getByRole('alert').filter({ hasText: '列表读取失败测试' }).waitFor();
  failList = false;
  await list.getByRole('button', { name: '重试', exact: true }).click();
  await list.getByRole('alert').waitFor({ state: 'detached' });
  for (let index = 0; index < 40; index++) {
    const id = `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`;
    records.set(id, make(id, `长列表课件 ${String(index).padStart(3, '0')}`, 0, []));
  }
  for (let index = 0; index < 2; index++) {
    const id = `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, '0')}`;
    records.set(id, make(id, `批量课件 ${index}`, 0, []));
  }
  await page.evaluate(() => window.dispatchEvent(new Event('mathmover_coursewares_changed')));
  await page.waitForFunction(() => document.querySelectorAll('[data-slot=aui_thread-list-item-trigger]').length === 42);
  const scroll = list.locator('[data-slot=aui_thread-list-items]');
  const dimensions = await scroll.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
  assert(dimensions.scroll > dimensions.client, 'long list scrolls inside sidebar');
  const footerBox = await page.getByRole('button', { name: '设置', exact: true }).boundingBox();
  assert(footerBox.y + footerBox.height <= 900, 'library footer stays visible');
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.getByRole('button', { name: '搜索课件', exact: true }).click();
  await search.waitFor();
  assert(await search.evaluate(element => element === document.activeElement));
  await search.fill('批量');
  assert.equal(await rows().count(), 2);
  await list.getByRole('button', { name: '选择', exact: true }).click();
  await list.getByRole('button', { name: '全选结果', exact: true }).click();
  await list.getByRole('button', { name: '删除所选课件', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await list.getByText('没有找到匹配的课件', { exact: true }).waitFor();
  assert.equal(writes.findLast(write => write.path.endsWith('/delete')).body.ids.length, 2);
  await search.fill('');
  await page.locator('aside[aria-label=课件侧栏]').screenshot({ path: output('long-list.png') });
  // Settings supports permanent single and bulk archive deletion in its native
  // modal, including failure/retry and keyboard dismissal of the confirmation.
  const archiveOne = 'ffffffff-ffff-4fff-8fff-000000000001';
  const archiveTwo = 'ffffffff-ffff-4fff-8fff-000000000002';
  for (const [id, title] of [[archiveOne, '归档删除验收一'], [archiveTwo, '归档删除验收二']]) {
    records.set(id, { ...make(id, title, 1, []), archived_at: new Date().toISOString() });
  }
  await openArchives();
  await row('归档删除验收一').waitFor();
  await menu('归档删除验收一'); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await archiveDeleteDialog.getByRole('button', { name: '取消', exact: true }).focus();
  await page.keyboard.press('Escape');
  await archiveDeleteDialog.waitFor({ state: 'detached' });
  assert(await page.locator('dialog[aria-labelledby=settings-title]').isVisible(), 'Escape closes confirmation and retains Settings');
  failDelete = true;
  await menu('归档删除验收一'); await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await archiveDeleteDialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await archiveDeleteDialog.getByRole('alert').filter({ hasText: '删除失败测试' }).waitFor();
  assert(records.has(archiveOne));
  failDelete = false;
  await archiveDeleteDialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await row('归档删除验收一').waitFor({ state: 'detached' });
  assert(!records.has(archiveOne));
  await archiveList.getByRole('button', { name: '选择', exact: true }).click();
  await row('归档删除验收二').click();
  await archiveList.getByRole('button', { name: '删除所选课件', exact: true }).click();
  await archiveDeleteDialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await archiveList.getByRole('status').filter({ hasText: '暂无归档课件' }).waitFor();
  assert(!records.has(archiveTwo));
  await page.locator('dialog[aria-labelledby=settings-title]').screenshot({ path: output('archives-empty.png') });
  await closeArchives();
  assert.deepEqual(errors, []);
  await writeFile(output('result.json'), JSON.stringify({ ok: true, scenarios: ['official runtime UI', 'date grouping', 'active selection', 'search', 'chat and complete canvas snapshot restore', 'rename cancel/save/conflict', 'keyboard navigation', 'Agent busy guards', 'archive failure retry', 'archive and unarchive active/inactive coursewares', 'archived chat/canvas restore and continued editing', 'Settings archive search and navigation', 'opening the current archive closes Settings', 'native Settings menu and confirmation portals', 'archive permanent deletion cancel/Escape/failure/retry/batch', 'permanent delete cancel/failure/success/last index', 'batch selection and multi-delete', 'active deletion resets canvas', 'sidebar collapse/expand and search focus', 'list retry', '42-row scroll and pinned footer'], writes: writes.length, pageErrors: errors }, null, 2));
  console.log('Courseware ThreadList regression passed; fixtures only, no database writes.');
} catch (error) {
  await writeFile(output('failure.json'), JSON.stringify({ message: error.message, pageErrors: errors, focusEvents: await page.evaluate(() => window.__focusEvents), writes }, null, 2));
  await page.screenshot({ path: output('failure.png') });
  throw error;
} finally { await browser.close(); }
