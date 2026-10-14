import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Real canvas; isolate database, configuration and bridge traffic.
const out = 'spike-out/responsive-board-toolbar';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let record = { id, title: '这是一个较长的数学课件标题，用于验证窄画板工具栏', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), messages: [],
  commands: ['A=(1,2)', 'a=1', 'b=2', 'c=3'], view: { showAxes: true, showGrid: true } };
await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [] } }));
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.route('**/api/coursewares**', route => {
  const request = route.request(), url = new URL(request.url());
  if (url.pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture-ticket' } });
  if (request.method() === 'GET') return route.fulfill({ json: url.pathname.endsWith(id) ? record : { records: [record], capabilities: { archive: true, permanentDelete: true } } });
  assert.equal(url.pathname, '/api/coursewares', 'only fixture autosaves are permitted');
  assert.equal(request.method(), 'POST');
  record = { ...record, ...request.postDataJSON(), revision: record.revision + 1 };
  return route.fulfill({ json: record });
});
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
const header = page.locator('[data-slot=board-toolbar]');
const group = page.getByRole('group', { name: '课件参数', exact: true });
const title = page.getByRole('button', { name: /^重命名课件：/ });
const handle = page.getByRole('separator', { name: '调整聊天区宽度' });
const rect = locator => locator.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; });
const settled = async () => {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => {
  const stage = document.querySelector('#ggb-element')?.parentElement, frame = document.querySelector('.GeoGebraFrame');
  return stage && frame && Math.abs(stage.clientWidth - frame.getBoundingClientRect().width) <= 2
    && Math.abs(stage.clientHeight - frame.getBoundingClientRect().height) <= 2;
  });
};
async function check(label) {
  await settled();
  const toolbar = await rect(header);
  const controls = await header.locator('[data-slot=board-toolbar-actions] button').evaluateAll(elements => elements.filter(el => el.checkVisibility()).map(el => {
    const r = el.getBoundingClientRect(), h = el.closest('header').getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { inside: r.left >= h.left && r.right <= h.right, clickable: !!hit && (el === hit || el.contains(hit)) };
  }));
  assert(controls.every(c => c.inside && c.clickable), label + ': buttons fit and remain clickable');
  assert.equal(await header.evaluate(el => el.scrollWidth > el.clientWidth), false, label + ': no toolbar overflow');
  assert((await rect(title)).width >= 100, label + ': readable title');
  assert.equal(await group.count(), 0, label + ': custom parameter row removed');
  const actions = await rect(header.locator('[data-slot=board-toolbar-actions]'));
  assert(actions.height <= 40, label + ': actions remain on one row in supported window sizes');

  const titleRect = await rect(header.locator('[data-slot=board-toolbar-title]'));
  assert(toolbar.width < 560 ? actions.y >= titleRect.bottom : Math.abs(actions.y + actions.height / 2 - titleRect.y - titleRect.height / 2) <= 1, label + ': canvas-based breakpoint');
  results.push({ label, canvasWidth: toolbar.width, toolbarHeight: toolbar.height, titleWidth: (await rect(title)).width });
}
try {
  await page.goto((process.argv[2] || 'http://localhost:3000') + '/dashboard?history_id=' + id);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.waitForFunction(() => window.ggbApplet?.exists?.('c'));
  await page.waitForFunction(() => !document.querySelector('button[aria-label^="重命名课件："]')?.disabled);
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__responsiveApi = window.ggbApplet; });
  await check('desktop-150');
  // Native GeoGebra slider remains editable after removing the duplicate React strip.
  await page.evaluate(() => {
    const api = window.ggbApplet;
    api.evalCommand('a=Slider(-10,10,0.1,1,150,false,true,false,false)');
    api.evalCommand('SetCoords(a,80,70)');
    api.setValue('a',1);
  });
  await page.waitForTimeout(250);
  const frame = await page.locator('.GeoGebraFrame').boundingBox();
  await page.mouse.move(frame.x + 162.5, frame.y + 70);
  await page.mouse.down();
  await page.mouse.move(frame.x + 195, frame.y + 70, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => Math.abs(window.ggbApplet.getValue('a') - 1) > 0.1);
  await page.evaluate(() => {
    const api = window.ggbApplet;
    window.__nativeValue = api.getValue('a');
    api.setAnimating('a',true); api.startAnimation();
  });
  await page.waitForFunction(() => window.ggbApplet.getValue('a') !== window.__nativeValue);
  await page.evaluate(() => {
    const api = window.ggbApplet;
    api.setAnimating('a',false); api.stopAnimation(); api.setValue('a',1);
  });
  await page.screenshot({ path: out + '/native-slider.png' });
  const before = await page.evaluate(() => JSON.parse(window.ggbApplet.getViewProperties(1)));
  const center = v => [v.xMin + v.width * v.invXscale / 2, v.yMin + v.height * v.invYscale / 2];
  const h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(h.x + h.width / 2 - i * 10, h.y + h.height / 2);
  await page.mouse.up(); await check('after-chat-drag');
  await handle.dblclick();
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.waitForTimeout(350); await check('sidebar-collapsed');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.waitForTimeout(350); await check('sidebar-expanded');
  for (const canvasWidth of [559, 560, 561]) {
    await page.setViewportSize({ width: canvasWidth + 640, height: 720 });
    await handle.dblclick(); await check('breakpoint-' + canvasWidth);
  }
  for (const [width, height] of [[910, 512], [800, 600]]) {
    await page.setViewportSize({ width, height });
    await handle.dblclick(); await check('small-' + width);
    for (const key of ['Home', 'End']) {
      await handle.focus(); await handle.press(key); await check('small-' + width + '-chat-' + key);
    }
    await title.click();
    const input = page.getByRole('textbox', { name: '课件名称', exact: true });
    const inputRect = await rect(input), toolbar = await rect(header);
    assert(inputRect.x >= toolbar.x && inputRect.right <= toolbar.right, 'title editor fits');
    await input.press('Escape');
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.getByRole('menu', { name: '导出', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('menu', { name: '导出', exact: true }).waitFor({ state: 'detached' });
    await page.screenshot({ path: out + '/small-' + width + '.png' });
  }
  await page.getByRole('button', { name: '全屏演示', exact: true }).click(); await check('fullscreen');
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.getByRole('button', { name: '全屏演示', exact: true }).waitFor(); await check('fullscreen-exit');
  const after = await page.evaluate(() => ({ sameApi: window.__responsiveApi === window.ggbApplet, hasPoint: window.ggbApplet.exists('A'), view: JSON.parse(window.ggbApplet.getViewProperties(1)) }));
  assert(after.sameApi && after.hasPoint, 'applet and construction preserved');
  center(before).forEach((value, i) => assert(Math.abs(value - center(after.view)[i]) < 0.01, 'view center preserved'));
  assert(Math.abs(before.invXscale - after.view.invXscale) < 0.0001, 'view scale preserved');
  assert.deepEqual(errors, []);
  const summary = { cases: results.length, results, nativeSliderWorks: true, constructionPreserved: true, centerAndScalePreserved: true, errors };
  await writeFile(out + '/results.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} finally { await browser.close(); }

