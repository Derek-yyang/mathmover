/**
 * 3D 坐标轴的**默认**与**归属**：
 *   A. 进入 3D 视图时宿主把坐轴打开（「3D 默认开轴」是宿主给的，不靠稿子写）；
 *   B. 但稿子仍是最终决定——`ShowAxes(3, false)` 能把它关掉（用户明确要求隐藏时要用）。
 *
 * 为什么要守：宿主原来用的是**三参** `setAxesVisible(true,true,true)`，那在 3D 下是
 * **空操作**（实测三个轴的 show 位一动不动，三参只作用于 2D）⇒ 「3D 默认开轴」从来没生效过，
 * 轴完全看稿子脸色。于是同一个「画一个正方体」两次生成，一次写 `ShowAxes(3,true)`、
 * 一次写 `ShowAxes(3,false)`，用户看到的就是「有时候坐标轴没了」（2026-10-19 报）。
 *
 * 运行：node scripts/verify-3d-axes-default.mjs [baseUrl]
 * 隔离：夹具课件、Agent 不调、daemon socket 只拦不转发——不碰真课件库与实时会话。
 */

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';
const record = {
  id: ID, title: '轴默认验证', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['MODE: 2D', 'O = (0,0)', 'E = Ellipse(O, 3, 2)'], messages: [],
  view: { showAxes: true, showGrid: true },
};

const geometry = ['MODE: 3D', 'A = (0, 0, 0)', 'B = (4, 0, 0)', 'C = (4, 4, 0)', 'D = (0, 4, 0)',
  'A1 = (0, 0, 4)', 'B1 = (4, 0, 4)', 'C1 = (4, 4, 4)', 'D1 = (0, 4, 4)',
  ...['AB', 'BC', 'CD', 'DA', 'A1B1', 'B1C1', 'C1D1', 'D1A1', 'AA1', 'BB1', 'CC1', 'DD1'].map((n) => `e${n} = Segment(${n[0]}, ${n.slice(1)})`)];
const framing = ['CenterView((2, 2, 2))', 'SetViewDirection((1, -1, 1))', 'ZoomIn(3)'];

/** 三个轴的 show 位，形如 '111' / '000'。 */
const readAxes = (page) => page.evaluate(`(function(){
  const block = /<euclidianView3D>[\\s\\S]*?<\\/euclidianView3D>/.exec(window.ggbApplet.getXML())?.[0] ?? '';
  const flags = [...block.matchAll(/<axis id="\\d" show="(\\w+)"/g)].map((m) => m[1] === 'true' ? '1' : '0');
  return flags.length === 3 ? flags.join('') : null;
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

const apply = (cmds) => page.evaluate(async (c) => {
  const timeout = new Promise((res) => setTimeout(() => res({ __timeout: true }), 60_000));
  return Promise.race([window.__mmGgb.apply({ commands: c, incremental: false }), timeout]);
}, cmds);

try {
  await page.goto(`${base}/dashboard`);
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.getByRole('button', { name: '轴默认验证', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForFunction(() => !!window.__mmGgb, null, { timeout: 30_000 });
  await page.waitForTimeout(1200);

  // ── A. 稿子**不写** ShowAxes(3, …) —— 轴不该被留在关着的状态 ────────────
  // 先把轴明确关掉（用四参形式，三参在 3D 下是空操作），免得测的其实是「默认就是开的」。
  // 注意这一条**不是**在测那条四参修复本身：刚切到 3D 时 GeoGebra 的默认就是开轴，
  // 所以有没有那行都会过。它守的是**结果**——宿主不会把 3D 的轴留在关着的状态。
  await page.evaluate(`(function(){
    window.ggbApplet.setPerspective('T');
    window.ggbApplet.setAxesVisible(3, false, false, false);
  })()`);
  await page.waitForTimeout(1200);
  assert.equal(await readAxes(page), '000', '前置：先把 3D 的轴关掉，下面才看得出它有没有被弄丢');

  assert.ok(!(await apply([...geometry, ...framing]))?.__timeout, 'A: apply 落定');
  await page.waitForTimeout(2000);
  const afterDefault = await readAxes(page);
  assert.equal(afterDefault, '111',
    `A: 稿子没写 ShowAxes 时，画面上不该是没有坐标轴的状态（实测 ${afterDefault}）`);

  // ── B. 稿子**明确写** ShowAxes(3, false) —— 稿子是最终决定 ───────────────
  assert.ok(!(await apply([...geometry, 'ShowAxes(3, false)', ...framing]))?.__timeout, 'B: apply 落定');
  await page.waitForTimeout(2000);
  const afterHide = await readAxes(page);
  assert.equal(afterHide, '000',
    `B: 稿子写 ShowAxes(3,false) 时坐轴该关掉——宿主默认不能盖过稿子（实测 ${afterHide}）`);

  // ── C. 再写回 true —— 还能开回来 ────────────────────────────────────────
  assert.ok(!(await apply([...geometry, 'ShowAxes(3, true)', ...framing]))?.__timeout, 'C: apply 落定');
  await page.waitForTimeout(2000);
  const afterShow = await readAxes(page);
  assert.equal(afterShow, '111', `C: ShowAxes(3,true) 应把坐轴开回来（实测 ${afterShow}）`);

  assert.deepEqual(errors, []);
  console.log('PASS: 3D 坐轴 —— 稿子不写时不落在「没有轴」的状态（000→111）、写 false 时关掉（→000）、写 true 时开回（→111）；0 浏览器错误。');
} finally {
  await browser.close();
}
