import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';
import { uploadImages } from './lib/upload-image.mjs';

// Real UI/GeoGebra with isolated courseware writes, images and Agent streams.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1544, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
const records = new Map(ids.map((id, index) => [id, {
  id, title: `课件${index + 1}`, revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  messages: [{ id: `${id}-user`, role: 'user', content: `已发送问题${index + 1}`, createdAt: Date.now() }],
  commands: [], view: { showAxes: true, showGrid: true },
}]));
await page.route('**/api/agent**', route => {
  assert.equal(route.request().method(), 'GET', 'Agent POST stays inside the fixture stream');
  return route.fulfill({ json: { runtimes: [{ id: 'claude-code', name: 'Claude Code', version: 'fixture', usable: true, canAttachImages: true }] } });
});
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.route('**/api/coursewares**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const parts = url.pathname.split('/').slice(3);
  if (parts[0] === 'windows') return route.fulfill({ json: { ok: true } });
  if (request.method() === 'GET') return route.fulfill({ json: parts.length ? records.get(parts[0]) : { records: [...records.values()], capabilities: { archive: true, permanentDelete: true } } });
  const body = request.postDataJSON();
  if (parts[0] === 'delete') {
    for (const id of body.ids) records.delete(id);
    return route.fulfill({ json: { ok: true } });
  }
  assert.equal(parts.length, 0, 'only fixture autosaves and deletes are expected');
  const next = { ...records.get(body.id), ...body, revision: (body.expectedRevision ?? 0) + 1 };
  records.set(body.id, next);
  return route.fulfill({ json: next });
});
await page.addInitScript(() => {
  window.__fileReads = 0;
  window.__readDelay = 0;
  const read = FileReader.prototype.readAsDataURL;
  FileReader.prototype.readAsDataURL = function(file) {
    window.__fileReads++;
    if (window.__readDelay) setTimeout(() => read.call(this, file), window.__readDelay);
    else read.call(this, file);
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (new URL(String(input), location.href).pathname === '/api/agent' && init?.method === 'POST') {
      window.__agentRequest = JSON.parse(init.body);
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        window.__finishAgent = () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ kind: 'done' }) + '\n'));
          controller.close();
        };
        init.signal.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), { once: true });
      } }), { headers: { 'content-type': 'application/x-ndjson' } }));
    }
    return realFetch(input, init);
  };
});
const input = page.getByRole('textbox', { name: '题目描述', exact: true });
const images = page.locator('[aria-label=待发送图片] img');
const open = async id => {
  await page.getByRole('button', { name: records.get(id).title, exact: true }).click();
  await page.waitForURL(`**history_id=${id}`);
  await page.locator(`header span[title="${records.get(id).title}"]`).waitFor();
  await page.getByText('已保存到本地', { exact: true }).waitFor();
};
const upload = files => uploadImages(page, files);
const assertText = expected => page.waitForFunction(expected => document.querySelector('[aria-label=题目描述]')?.value === expected, expected);
const finish = async () => {
  await page.evaluate(() => window.__finishAgent());
  await page.waitForFunction(() => !document.querySelector('[aria-label=停止本轮]') || document.querySelector('[aria-label=停止本轮]').getAttribute('aria-hidden') === 'true');
  await page.getByText('已保存到本地', { exact: true }).waitFor();
};
try {
  await stubConstructionDraft(page);
  await page.goto(`${process.argv[2] || 'http://localhost:3000'}/dashboard?history_id=${ids[0]}`);
  await page.locator('span[aria-label="当前 Agent：Claude Code"]').waitFor();
  await page.getByText('已保存到本地', { exact: true }).waitFor({ timeout: 60_000 });
  await page.addStyleTag({ content: 'nextjs-portal { display:none !important; }' });
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    canvas.getContext('2d').fillRect(0, 0, 10, 10);
    return canvas.toDataURL('image/png');
  });
  const file = name => ({ name, mimeType: 'image/png', buffer: Buffer.from(imageData.split(',')[1], 'base64') });
  await input.fill('课件1的草稿\n第二行');
  await upload(file('第一张.png'));
  await images.waitFor();
  const readsBefore = await page.evaluate(() => window.__fileReads);
  await open(ids[1]);
  await assertText('');
  assert.equal(await images.count(), 0);
  await input.fill('课件2的独立草稿');
  await upload(file('第二张.png'));
  await images.waitFor();
  await open(ids[0]);
  await assertText('课件1的草稿\n第二行');
  assert.equal(await images.count(), 1);
  assert.equal(await images.first().getAttribute('src'), imageData);
  assert.equal(await page.evaluate(() => window.__fileReads), readsBefore + 1, 'restoring prepared images does not reread them');
  await page.getByRole('button', { name: '预览待发送图片：第一张.png', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  // Message editing uses a separate composer and must not overwrite this draft.
  const user = page.locator(`[data-chat-message-id="${ids[0]}-user"]`);
  await user.hover();
  await user.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('textbox', { name: '修改消息', exact: true }).fill('取消这次修改');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await assertText('课件1的草稿\n第二行');
  // Switching during a pending preview read must preserve the File too.
  await page.evaluate(() => { window.__readDelay = 1500; });
  await upload([file('读取中的图片.png'), file('同批读取中的图片.png')]);
  await page.getByRole('button', { name: '预览待发送图片：读取中的图片.png', exact: true }).waitFor();
  await page.getByRole('button', { name: '预览待发送图片：同批读取中的图片.png', exact: true }).waitFor();
  assert(await page.getByRole('button', { name: '发送消息', exact: true }).isDisabled(), 'pending image preparation cannot dispatch a send into another courseware');
  await open(ids[1]);
  await assertText('课件2的独立草稿');
  await page.evaluate(() => { window.__readDelay = 0; });
  await open(ids[0]);
  await assertText('课件1的草稿\n第二行');
  await page.waitForFunction(() => !document.querySelector('[aria-label="预览待发送图片：读取中的图片.png"]')?.disabled);
  await page.waitForFunction(() => !document.querySelector('[aria-label="预览待发送图片：同批读取中的图片.png"]')?.disabled);
  assert.equal(await images.count(), 3);
  await page.getByRole('button', { name: '移除图片：第一张.png', exact: true }).click();
  await page.getByRole('button', { name: '移除图片：同批读取中的图片.png', exact: true }).click();
  await open(ids[1]); await open(ids[0]);
  assert.equal(await images.count(), 1);
  assert.equal(await images.first().getAttribute('alt'), '读取中的图片.png');
  // Restored attachments still obey the four-image limit.
  await upload(['第三张.png', '第四张.png', '第五张.png', '超出限制.png'].map(file));
  await page.getByRole('alert').filter({ hasText: '一次最多添加 4 张' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[aria-label=待发送图片] img').length === 4 && !document.querySelector('[aria-label=发送消息]').disabled);
  assert.equal(await images.count(), 4);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.waitForFunction(() => window.__agentRequest?.text === '课件1的草稿\n第二行');
  assert.deepEqual(await page.evaluate(() => window.__agentRequest.images.map(item => item.name)), ['读取中的图片.png', '第三张.png', '第四张.png', '第五张.png']);
  await finish();
  await open(ids[1]); await open(ids[0]);
  await assertText('');
  assert.equal(await images.count(), 0, 'a sent draft is not restored');
  await open(ids[1]);
  await assertText('课件2的独立草稿');
  // Explicit new editors start empty; first saves must not remount their input.
  await page.getByRole('button', { name: '新建课件', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await assertText('');
  assert.equal(await images.count(), 0);
  await input.fill('新课件的第一轮');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.waitForFunction(() => window.__agentRequest?.text === '新课件的第一轮');
  await input.fill('生成期间输入的下一轮草稿');
  await finish();
  const created = [...records.values()].find(record => !ids.includes(record.id));
  assert(created);
  await open(ids[0]); await open(created.id);
  await assertText('生成期间输入的下一轮草稿');
  await input.fill('');
  await open(ids[0]); await open(created.id);
  await assertText('');
  await input.fill('删除课件时要清理的草稿');
  const row = page.getByRole('button', { name: created.title, exact: true }).locator('..');
  await row.hover(); await row.getByRole('button', { name: '课件操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.waitForURL('**/dashboard');
  await assertText('');
  assert(!records.has(created.id));
  // First autosave may also be triggered by a canvas edit before any message.
  await input.fill('画板首次保存时保留的草稿');
  await upload(file('首次保存前的图片.png'));
  await images.waitFor();
  await page.evaluate(() => window.ggbApplet.evalCommand('DraftSavePoint=(1,2)'));
  await page.waitForURL(/history_id=/);
  await page.getByText('已保存到本地', { exact: true }).waitFor();
  const canvasSavedId = new URL(page.url()).searchParams.get('history_id');
  await assertText('画板首次保存时保留的草稿');
  assert.equal(await images.count(), 1);
  await open(ids[0]); await open(canvasSavedId);
  await assertText('画板首次保存时保留的草稿');
  assert.equal(await images.count(), 1);
  assert.deepEqual(errors, []);
  await mkdir('spike-out/composer-drafts', { recursive: true });
  await writeFile('spike-out/composer-drafts/result.json', JSON.stringify({ ok: true, pageErrors: errors, scenarios: ['independent text/image drafts', 'no repeat preview reads', 'restored preview/removal', 'pending File batch recovery', 'four-image limit', 'message edit isolation', 'send clears draft', 'new editor starts empty', 'first save preserves next draft', 'first canvas save preserves text and images', 'manual clearing persists', 'active deletion resets editor'] }, null, 2));
  console.log('Composer draft regression passed; fixture writes and streams only.');
} catch (error) {
  await mkdir('spike-out/composer-drafts', { recursive: true });
  await page.screenshot({ path: 'spike-out/composer-drafts/failure.png' });
  await writeFile('spike-out/composer-drafts/failure.json', JSON.stringify({ error: error.message, pageErrors: errors, text: await input.inputValue().catch(() => null) }, null, 2));
  throw error;
} finally { await browser.close(); }
