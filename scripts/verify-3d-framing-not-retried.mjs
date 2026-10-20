/**
 * 3D 取景**只跑一遍**的回归：`ZoomIn` 这类相对命令不能被「补漏」那遍重跑。
 *
 * 守的是什么：`evalCommand` 对视图类命令（`ZoomIn`/`ZoomOut`/`CenterView`/
 * `SetViewDirection`）**成功时也返回 false**——与 `Set*`/`Show*` 同一类「假失败」。
 * 宿主原来拿返回值判失败、300ms 后原样重跑一遍，于是相对取景被乘了两次。
 * 实测同一份稿子：一遍 scale 150 / 朝向 (35.3,-45) / PNG 169k；两遍 scale **374** /
 * 朝向翻到镜像 (-35.3,135) / PNG 125k——画面上就是「放得太大、贴到图形上」。
 *
 * 为什么走 `window.__mmGgb.apply()`：这才是宿主真正的执行路径（hook 的 execList +
 * 补漏 + 相机回标准全在里面）。直接 evalCommand 复刻不出来，也就不算守住了。
 *
 * 运行：node scripts/verify-3d-framing-not-retried.mjs [baseUrl]
 * 隔离：夹具课件、Agent 不调、daemon socket 只拦不转发——不碰真课件库与实时会话。
 */

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const record = {
  id: ID, title: '取景单遍验证', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['MODE: 2D', 'O = (0,0)', 'E = Ellipse(O, 3, 2)'],
  messages: [], view: { showAxes: true, showGrid: true },
};

// 用户 2026-10-19 报「画一个正方体」后放得过大的那份稿子的取景尾部
// （前 38 行是几何定义，这里保留原样以便 scale 的期望值可对照真实现场）。
const draft = [
  'MODE: 3D',
  'ShowAxes(3, true)',
  'ShowGrid(3, true)',
  'A = (0, 0, 0)',
  'SetFixed(A, true)',
  'ShowLabel(A, true)',
  'vx = Vector((0, 0, 0), (2, 0, 0))',
  'vy = Vector((0, 0, 0), (0, 2, 0))',
  'vz = Vector((0, 0, 0), (0, 0, 2))',
  'SetVisibleInView(vx, 3, false)',
  'SetVisibleInView(vy, 3, false)',
  'SetVisibleInView(vz, 3, false)',
  'B = A + vx',
  'D = A + vy',
  'C = A + vx + vy',
  'A1 = A + vz',
  'B1 = B + vz',
  'C1 = C + vz',
  'D1 = D + vz',
  'eAB = Segment(A, B)',
  'eBC = Segment(B, C)',
  'eCD = Segment(C, D)',
  'eDA = Segment(D, A)',
  'eA1B1 = Segment(A1, B1)',
  'eB1C1 = Segment(B1, C1)',
  'eC1D1 = Segment(C1, D1)',
  'eD1A1 = Segment(D1, A1)',
  'eAA1 = Segment(A, A1)',
  'eBB1 = Segment(B, B1)',
  'eCC1 = Segment(C, C1)',
  'eDD1 = Segment(D, D1)',
  'CenterView((1, 1, 1))',
  'SetViewDirection((1, -1, 1))',
  'ZoomIn(3)',
];

/** 标准 3D 视域是 scale 50，`ZoomIn(3)` 一遍 = 150；两遍（旧行为）= 374。 */
const EXPECTED_SCALE = 150;
const DOUBLED_SCALE = 374;

const readCamera = (page) => page.evaluate(`(function(){
  const block = /<euclidianView3D>[\\s\\S]*?<\\/euclidianView3D>/.exec(window.ggbApplet.getXML());
  if (!block) return null;
  const coord = /<coordSystem([^>]*)\\/?>/.exec(block[0]);
  if (!coord) return null;
  const attrs = {};
  for (const m of coord[1].matchAll(/(\\w+)="([^"]*)"/g)) attrs[m[1]] = Number(m[2]);
  return { scale: attrs.scale, xAngle: attrs.xAngle, zAngle: attrs.zAngle };
})()`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/agent**', (route) => route.fulfill({ json: { runtimes: [] } }));
await page.route('**/api/byok', (route) => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.route('**/api/coursewares**', (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture-ticket' } });
  if (route.request().method() === 'GET') {
    return route.fulfill({ json: url.pathname.endsWith(ID) ? record : { records: [record], capabilities: { archive: true, permanentDelete: true } } });
  }
  return route.fulfill({ json: record });
});
await page.routeWebSocket('ws://127.0.0.1:8787', (socket) => socket.onMessage(() => {}));
await stubConstructionDraft(page, { commands: record.commands });

try {
  await page.goto(`${base}/dashboard`);
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.getByRole('button', { name: '取景单遍验证', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForFunction(() => !!window.__mmGgb, null, { timeout: 30_000 });
  await page.waitForTimeout(1200);

  // 走宿主真实路径：全量下发（2D 课件 → 3D 稿子，前缀不匹配 ⇒ 必然全量）
  const result = await page.evaluate(async (cmds) => {
    const timeout = new Promise((res) => setTimeout(() => res({ __timeout: true }), 60_000));
    return Promise.race([window.__mmGgb.apply({ commands: cmds, incremental: false }), timeout]);
  }, draft);
  assert.ok(!result?.__timeout, 'the apply resolved (the hook did not hang)');

  // 视图命令是异步生效的：等它落定再读，否则读到的是旧相机
  await page.waitForTimeout(2000);
  const camera = await readCamera(page);
  assert.ok(camera, 'the 3D camera is readable after the apply');

  const png = await page.evaluate('window.ggbApplet.getPNGBase64(1, false)');
  const objects = await page.evaluate('window.ggbApplet.getObjectNumber()');

  assert.ok(Math.abs(camera.scale - EXPECTED_SCALE) < 12,
    `取景只跑一遍：scale 应落在 ${EXPECTED_SCALE} 附近，实测 ${camera.scale}`
    + `（旧行为重跑一遍会到 ${DOUBLED_SCALE}）`);
  assert.ok(camera.scale < DOUBLED_SCALE * 0.6,
    `取景没有被「补漏」那遍乘第二遍（实测 ${camera.scale}，重跑的现场是 ${DOUBLED_SCALE}）`);
  // 重跑还会把 SetViewDirection 翻到镜像分支 (-35.3, 135)——用 zAngle 的符号区分
  assert.ok(camera.zAngle < 0,
    `朝向没翻到镜像分支（zAngle 实测 ${camera.zAngle}，镜像分支是 +135）`);
  assert.ok(objects >= 20, `立方体的对象都在画布上（getObjectNumber=${objects}）`);
  assert.ok(png.length > 60_000, `画面有内容、不是一片白（PNG ${png.length} 字节）`);

  assert.deepEqual(errors, []);
  console.log(`PASS: 3D 取景只跑一遍 —— scale ${camera.scale}（期望 ${EXPECTED_SCALE}，重跑是 ${DOUBLED_SCALE}）、`
    + `朝向 ${camera.xAngle.toFixed(1)}/${camera.zAngle.toFixed(1)}、${objects} 个对象、PNG ${png.length} 字节；0 浏览器错误。`);
} finally {
  await browser.close();
}
