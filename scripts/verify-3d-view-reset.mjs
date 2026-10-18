/**
 * 「重置视图居中」在 3D 下的回归：真实 GeoGebra + 净室接口替身，点的是真按钮。
 *
 * 为什么值得单独守：3D 相机没有任何可用的重置命令（`setPerspective` 空操作、
 * `SetViewDirection` 会随机落到镜像分支、`ZoomIn(-10)` 的负因子把画面拉爆），
 * 只能取当前构造 XML、换掉 `<euclidianView3D>` 块再 setXML（见 lib/ggb-view-reset.ts）。
 * 这条链路跨 React（按钮 → hook → 库）与 GeoGebra 两界，单元测试只覆盖得了一半。
 *
 * 运行：node scripts/verify-3d-view-reset.mjs [baseUrl]
 * 隔离：课件接口是夹具、Agent 不调、daemon socket 只拦不转发——不碰真课件库与实时会话。
 */

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const record = {
  id: ID, title: '3D重置验证', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['MODE: 3D', 'A=(1,1,1)', 'B=(2,2,2)', 'Cube(A,B)'],
  messages: [{ id: `${ID}-user`, role: 'user', content: '画一个立方体', createdAt: Date.now() }],
  view: { showAxes: true, showGrid: true },
};

/** 只认标准视角这几个字段：交互过的视图可能多出 yscale/zscale，不该影响判定。 */
const readCamera = (page) => page.evaluate(`(function(){
  const block = /<euclidianView3D>[\\s\\S]*?<\\/euclidianView3D>/.exec(window.ggbApplet.getXML());
  if (!block) return null;
  const coord = /<coordSystem([^>]*)\\/?>/.exec(block[0]);
  if (!coord) return null;
  const attrs = {};
  for (const m of coord[1].matchAll(/(\\w+)="([^"]*)"/g)) attrs[m[1]] = Number(m[2]);
  const { xZero, yZero, zZero, scale, xAngle, zAngle } = attrs;
  return { xZero, yZero, zZero, scale, xAngle, zAngle };
})()`);
const readPng = (page) => page.evaluate('window.ggbApplet.getPNGBase64(1, false)');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [] } }));
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.route('**/api/coursewares**', route => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture-ticket' } });
  if (route.request().method() === 'GET') {
    return route.fulfill({ json: url.pathname.endsWith(ID) ? record : { records: [record], capabilities: { archive: true, permanentDelete: true } } });
  }
  return route.fulfill({ json: record });
});
// 拦而不断开：页面以为连着（不然打开课件会被"画板未连接"挡住），但一个字节都不进真 daemon。
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await stubConstructionDraft(page, { commands: record.commands });
try {
  await page.goto(`${base}/dashboard`);
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.getByRole('button', { name: '3D重置验证', exact: true }).click();
  await page.getByRole('button', { name: '重命名课件：3D重置验证', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForTimeout(1200);

  // 打开时的 3D 课件就是标准视角——这是后面要回的那个基准
  const opened = await readCamera(page);
  assert.deepEqual(opened, { xZero: 0, yZero: 0, zZero: -1.5, scale: 50, xAngle: 20, zAngle: -60 },
    `fresh 3D courseware opens on the standard view (got ${JSON.stringify(opened)})`);
  const beforePng = await readPng(page);

  // 拖动转视角 + 滚轮改缩放：相机与画面都得变（不变的话后面的断言等于没测）
  const box = await page.locator('[aria-label=数学课件画布] canvas').first().boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 24, cy - i * 13);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const rotated = await readCamera(page);
  assert.notDeepEqual(rotated, opened, 'dragging actually rotated the 3D view');
  assert.notEqual(await readPng(page), beforePng, 'the rendered canvas changed with the rotation');

  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(800);
  const zoomed = await readCamera(page);
  assert.notEqual(zoomed.scale, opened.scale, `the wheel actually zoomed the 3D view (scale ${zoomed.scale})`);

  // 平移是必须测的一步：它会让 GeoGebra 把 y/z 缩放标成显式值，只打 XML 补丁清不掉，
  // 画面会与全新视图差约 1.3% 像素——收尾那次七参 setCoordSystem 就是为它准备的。
  await page.keyboard.down('Shift');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cx + i * 15, cy + i * 10);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(800);
  const panned = await readCamera(page);
  assert(panned.zZero !== opened.zZero, `shift+drag actually panned the 3D view (zZero ${panned.zZero})`);

  const button = page.getByRole('button', { name: '重置视图居中', exact: true });
  assert(await button.isEnabled(), 'reset button is enabled once the courseware is open');
  await button.click();

  // 重置是逐帧补丁动画（3D 没有便宜的「只设相机」接口），点完不该已经到位：
  // 采样能看到中间态，才说明是滑过去而不是瞬移。同时它也必须有终点。
  const samples = [];
  for (let i = 0; i < 20; i++) {
    samples.push(await readCamera(page));
    if (samples.at(-1) && samples.at(-1).xAngle === opened.xAngle && samples.at(-1).zAngle === opened.zAngle && i > 0) break;
    await page.waitForTimeout(30);
  }
  const midway = samples.filter((c) => c && c.zAngle !== rotated.zAngle && c.zAngle !== opened.zAngle);
  assert(midway.length > 0, `the reset animates through intermediate cameras (saw ${JSON.stringify(samples.map((c) => c?.zAngle))})`);
  await page.waitForFunction((target) => {
    const block = /<euclidianView3D>[\s\S]*?<\/euclidianView3D>/.exec(window.ggbApplet.getXML());
    return !!block && block[0].includes(`xAngle="${target.xAngle}" zAngle="${target.zAngle}"`);
  }, opened, { timeout: 5000 });
  await page.waitForTimeout(400);

  const reset = await readCamera(page);
  assert.deepEqual(reset, opened, `reset restores the standard view (got ${JSON.stringify(reset)})`);
  assert.equal(await readPng(page), beforePng, 'the reset render is pixel-identical to the pre-rotation canvas');

  // 再点一次不该把视角翻到镜像分支（SetViewDirection 时代的坑）
  await button.click();
  await page.waitForTimeout(1000);
  assert.deepEqual(await readCamera(page), opened, 'clicking reset twice stays on the standard view');

  // 注：跳变路径（prefers-reduced-motion / 大构造）在**平移过**之后会留下显式的 y/z 缩放，
  // 画面与全新视图差约 1.3% 像素；清除它需要 setCoordSystem 再等 ~400ms，代价是可见的二次跳动。
  // 权衡后保留现状，故不在此断言——详见 lib/ggb-view-reset.ts 的「已知残留」注释。

  // 打开课件时相机回标准 —— 稿子里的相对缩放因此有确定起点
  // （不这样做的话，ZoomIn 会跟画布残留的缩放叠加：实测有一轮叠到了立方体内部）
  await page.evaluate(() => window.ggbApplet.evalCommand('ZoomIn(8)'));
  await page.waitForTimeout(500);
  assert.notEqual((await readCamera(page)).scale, opened.scale, 'the ledger-style zoom actually changed the scale');

  await page.reload();
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.getByRole('button', { name: '3D重置验证', exact: true }).click();
  await page.getByRole('button', { name: '重命名课件：3D重置验证', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForTimeout(1000);
  assert.deepEqual(await readCamera(page), opened, 'opening the courseware resets the camera to the standard view');

  await page.evaluate(() => window.ggbApplet.evalCommand('ZoomIn(8)'));
  await page.waitForTimeout(500);
  const framed = (await readCamera(page)).scale;
  assert.ok(Math.abs(framed - opened.scale * 8) < 0.5, `the ledger's relative zoom is reproducible from that start (got ${framed})`);

  assert.deepEqual(errors, []);
  console.log('PASS: 3D 夹具课件：拖动+滚轮+平移后点真按钮逐帧滑回标准视角与缩放（非瞬移）、渲染逐字节复现、按钮可重复点、打开课件时相机回标准使稿子取景可复现；0 浏览器错误。');
} finally { await browser.close(); }
