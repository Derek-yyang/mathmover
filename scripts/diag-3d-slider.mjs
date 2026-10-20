/**
 * 诊断：3D 课件里的**滑块**用户到底看不看得见。
 *
 * 现场（2026-10-20）：agent 用 `t = Slider(0,1,0.01)` + `M = Point(dAC1, t)` 驱动 3D 动点，
 * 用户反馈画面上没有滑块可拖，3D 里动点靠直接在图上拖。
 *
 * 按宿主的真路径下发两份几乎相同的 3D 稿子，唯一差别是 M 的定义：
 *   A. `M = Point(dAC1, t)`  —— 受滑块驱动（两参）
 *   B. `M = Point(dAC1)`     —— 直接拖的路径点（单参）
 * 各自截一张 GeoGebra 画布 PNG，肉眼比对有没有滑块。
 *
 * 运行：node scripts/diag-3d-slider.mjs [baseUrl]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6';
const record = {
  id: ID, title: '滑块诊断', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['MODE: 2D', 'O = (0,0)'], messages: [], view: { showAxes: true, showGrid: true },
};
const cube = ['MODE: 3D', 'A = (0, 0, 0)', 'B = (2, 0, 0)', 'D = (0, 2, 0)', 'C = (2, 2, 0)',
  'A1 = (0, 0, 2)', 'B1 = (2, 0, 2)', 'C1 = (2, 2, 2)', 'D1 = (0, 2, 2)',
  'dAC1 = Segment(A, C1)', 'ShowLabel(M, true)'];
const withSlider = [...cube, 't = Slider(0, 1, 0.01)', 'SetValue(t, 0.5)', 'M = Point(dAC1, t)', 'CenterView((1, 1, 1))', 'ZoomIn(3)'];
const withPathPoint = [...cube, 'M = Point(dAC1)', 'CenterView((1, 1, 1))', 'ZoomIn(3)'];

await mkdir('spike-out', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.setDefaultTimeout(30_000);
await page.route('**/api/agent**', (r) => r.fulfill({ json: { runtimes: [] } }));
await page.route('**/api/byok', (r) => r.fulfill({ json: { apiKeyConfigured: false } }));
await page.routeWebSocket('ws://127.0.0.1:8787', (socket) => socket.onMessage(() => {}));
await page.route('**/api/coursewares**', (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture-ticket' } });
  if (route.request().method() === 'GET') {
    return route.fulfill({ json: url.pathname.endsWith(ID) ? record : { records: [record], capabilities: { archive: true, permanentDelete: true } } });
  }
  return route.fulfill({ json: record });
});
await stubConstructionDraft(page, { commands: record.commands });

const apply = (cmds) => page.evaluate(async (c) => {
  const timeout = new Promise((res) => setTimeout(() => res({ __timeout: true }), 60_000));
  return Promise.race([window.__mmGgb.apply({ commands: c, incremental: false }), timeout]);
}, cmds);
const shot = async (name) => {
  const b64 = await page.evaluate(() => window.ggbApplet.getPNGBase64(1, false));
  await writeFile(`spike-out/${name}.png`, Buffer.from(b64, 'base64'));
  return b64.length;
};

try {
  await page.goto(`${base}/dashboard?history_id=${ID}`, { timeout: 90_000 });
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForFunction(() => !!window.__mmGgb, null, { timeout: 30_000 });
  await page.waitForTimeout(1200);

  console.log('--- A. 滑块驱动 Point(dAC1, t) ---');
  await apply(withSlider);
  await page.waitForTimeout(2200);
  const a = await shot('slider-3d-with-slider');
  const infoA = await page.evaluate(() => ({
    objects: window.ggbApplet.getAllObjectNames(),
    mDef: window.ggbApplet.getDefinitionString('M'),
    tValue: window.ggbApplet.getValue('t'),
  }));
  console.log('  PNG 字节:', a);
  console.log('  对象:', JSON.stringify(infoA.objects));
  console.log('  M 的定义:', JSON.stringify(infoA.mDef), '| t =', infoA.tValue);

  console.log('--- B. 直接拖的路径点 Point(dAC1) ---');
  await apply(withPathPoint);
  await page.waitForTimeout(2200);
  const b = await shot('slider-3d-path-point');
  const infoB = await page.evaluate(() => ({
    objects: window.ggbApplet.getAllObjectNames(),
    mDef: window.ggbApplet.getDefinitionString('M'),
  }));
  console.log('  PNG 字节:', b);
  console.log('  M 的定义:', JSON.stringify(infoB.mDef));

  // 两张图差多少：若只差滑块，差异应集中在某个小区域
  console.log('\n两张 PNG 是否相同:', a === b, `(${a} vs ${b})`);
} finally {
  await browser.close();
}
