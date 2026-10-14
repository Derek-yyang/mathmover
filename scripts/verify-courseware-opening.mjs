import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Real local GeoGebra; all data, credentials, Agent and socket traffic isolated.
const out = 'spike-out/courseware-opening';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
const records = new Map(ids.map((id, i) => [id, { id, title: `保护验证${i + 1}`, revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), commands: [`A=(${i + 1},2)`],
  messages: [{ id: `${id}-user`, role: 'user', content: `已保存问题${i + 1}`, createdAt: Date.now() }], view: { showAxes: true, showGrid: true } }]));
const errors = [], loads = [], writes = [];
let holdSave = false, releaseSave, incoming = 'hold', releaseLoad;
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => {
  assert.equal(route.request().method(), 'GET', 'no model invocation');
  return route.fulfill({ json: { runtimes: [{ id: 'fixture', name: '测试 Agent', usable: true, version: 'fixture', canAttachImages: true }] } });
});
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await page.route('**/api/coursewares**', async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture-ticket' } });
  if (req.method() === 'GET') {
    const id = ids.find(id => url.pathname.endsWith(id));
    if (id) loads.push(id);
    if (id === ids[1]) {
      if (incoming === 'hold') await new Promise(resolve => { releaseLoad = resolve; });
      if (incoming === 'fail') return route.fulfill({ status: 503, json: { error: '测试读取失败' } });
    }
    return route.fulfill({ json: id ? records.get(id) : { records: [...records.values()], capabilities: { archive: true, permanentDelete: true } } });
  }
  assert.equal(url.pathname, '/api/coursewares', 'only fixture autosaves');
  const body = req.postDataJSON(); writes.push(body.id);
  if (holdSave) await new Promise(resolve => { releaseSave = resolve; });
  const saved = { ...records.get(body.id), ...body, revision: (body.expectedRevision ?? 0) + 1 };
  records.set(body.id, saved);
  return route.fulfill({ json: saved });
});
const poll = async predicate => {
  for (let i = 0; i < 300 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert(predicate(), 'fixture request arrived');
};
const ready = async i => {
  await page.waitForFunction(x => window.ggbApplet?.getXcoord?.('A') === x, i + 1);
  await page.getByRole('button', { name: `重命名课件：保护验证${i + 1}`, exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
};
const guard = page.locator('[data-slot=board-interaction-guard]');
const assertProtected = async () => {
  await page.getByText('正在打开课件…', { exact: true }).waitFor();
  assert(await guard.isVisible());
  for (const name of ['显示坐标轴', '显示网格', '画板设置', '重置视图居中', '导出']) {
    assert(await page.getByRole('button', { name, exact: true }).isDisabled(), `${name} blocked during opening`);
  }
  assert(await page.getByRole('button', { name: '发送消息', exact: true }).isDisabled());
  assert.equal(await page.locator('[aria-label=数学课件画布]').getAttribute('aria-busy'), 'true');
  assert(await guard.evaluate(el => {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[data-slot=board-interaction-guard]') === el;
  }), 'overlay intercepts canvas pointers');
  assert(await page.locator('[aria-label=数学课件画布] > div[inert]').count() === 1, 'native canvas keyboard interaction is inert');
};
try {
  await page.goto(`${process.argv[2] || 'http://localhost:3000'}/dashboard?history_id=${ids[0]}`);
  await ready(0);
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  const applet = await page.evaluateHandle(() => window.ggbApplet);
  const upload = page.locator('input[type=file]');
  const img = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 20; c.getContext('2d').fillRect(0, 0, 20, 20); return c.toDataURL().split(',')[1]; });
  const file = i => ({ name: `题图${i}.png`, mimeType: 'image/png', buffer: Buffer.from(img, 'base64') });
  await upload.setInputFiles([1, 2, 3, 4, 5].map(file));
  const limit = page.getByText('一次最多添加 4 张题目图片。', { exact: true });
  await limit.waitFor();
  await page.getByRole('button', { name: '移除图片：题图1.png', exact: true }).click();
  await limit.waitFor({ state: 'detached' });
  assert.equal(await page.locator('[aria-label=待发送图片] img').count(), 3);
  await upload.setInputFiles([file(6)]);
  await page.waitForFunction(() => document.querySelectorAll('[aria-label=待发送图片] img').length === 4);
  assert.equal(await limit.count(), 0, 'adding a fourth valid image does not revive a resolved warning');
  await upload.setInputFiles({ name: '错误格式.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture') });
  const formatError = page.getByText('请使用 PNG、JPEG、WebP 或 GIF 图片。', { exact: true });
  await formatError.waitFor();
  await page.getByRole('button', { name: '移除图片：题图2.png', exact: true }).click();
  assert(await formatError.isVisible(), 'removing an image does not clear an unrelated format error');
  await page.screenshot({ path: `${out}/image-limit-resolved.png` });

  // Navigation blocks immediately, including before the outgoing snapshot finishes.
  holdSave = true;
  await page.evaluate(() => window.ggbApplet.setCoords('A', 1, 3));
  await page.getByRole('button', { name: '保护验证2', exact: true }).click();
  await assertProtected();
  await poll(() => !!releaseSave);
  assert.equal(loads.includes(ids[1]), false, 'outgoing snapshot finishes before incoming read');
  holdSave = false; releaseSave();
  await poll(() => !!releaseLoad);
  await assertProtected();
  assert.equal(await page.evaluate(() => window.ggbApplet.getXcoord('A')), 1);
  const before = await page.evaluate(() => window.ggbApplet.getXML());
  const box = await guard.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 40); await page.mouse.up();
  assert.equal(await page.evaluate(() => window.ggbApplet.getXML()), before, 'dragging the protected canvas cannot alter the old view');
  await page.screenshot({ path: `${out}/narrow-opening.png` });
  incoming = 'fast'; releaseLoad();
  await ready(1);
  assert(await page.evaluate(api => api === window.ggbApplet, applet), 'courseware switching preserves the applet');
  assert(await page.getByRole('button', { name: '显示坐标轴', exact: true }).isEnabled());
  await page.getByRole('button', { name: '显示坐标轴', exact: true }).click();
  assert((await page.evaluate(() => window.ggbApplet.getXML())).includes('axes="false"'), 'controls work after restoration');

  // Cancel a held incoming read by returning to the currently committed courseware.
  await page.getByRole('button', { name: '保护验证1', exact: true }).click();
  await ready(0);
  incoming = 'hold'; releaseLoad = undefined;
  await page.getByRole('button', { name: '保护验证2', exact: true }).click();
  await poll(() => !!releaseLoad); await assertProtected();
  await page.getByRole('button', { name: '保护验证1', exact: true }).click();
  await page.waitForURL(`**history_id=${ids[0]}`);
  incoming = 'fast'; releaseLoad();
  await ready(0);
  assert(await page.evaluate(api => api === window.ggbApplet, applet));

  incoming = 'fail';
  await page.getByRole('button', { name: '保护验证2', exact: true }).click();
  await page.getByText('课件未能打开，请重试。', { exact: true }).waitFor();
  assert.equal(await page.locator('[aria-label=数学课件画布]').getAttribute('aria-busy'), 'false');
  assert(await page.getByRole('button', { name: '显示网格', exact: true }).isDisabled());
  await page.getByRole('button', { name: '保护验证3', exact: true }).click();
  await ready(2);
  await page.screenshot({ path: `${out}/recovered.png` });
  assert.deepEqual(errors, []);
  await writeFile(`${out}/results.json`, JSON.stringify({ outgoingSaveProtected: true, narrowLoadingVisible: true, mouseAndKeyboardBlocked: true,
    sameApplet: true, cancelledReturnRecovers: true, failedOpenProtected: true, imageLimitResolves: true, unrelatedImageErrorRetained: true, errors }, null, 2));
  console.log('PASS: opening/save/failed restore protected; same applet; cancelled return recovers; image limit resolves without clearing format errors.');
} finally { await browser.close(); }
