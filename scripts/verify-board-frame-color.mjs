/**
 * 画板外框**颜色钉死**的回归。
 *
 * 守什么：GeoGebra 把 applet 外框的 border-color 写在**行内** style 上，并且会自己改它
 * （平时浅灰、拖入文件时红、用户现场还见过纯黑）。`globals.css` 里那条
 * `.geogebra-stage .GeoGebraFrame { border-color: … !important }` 就是把它钉死。
 *
 * 这条守卫的关键不是"平时是浅灰"（那本来就成立），而是**行内被改成别的颜色时，
 * 样式表仍然赢**——所以最后一步先模拟 GeoGebra 写一个行内黑色，再读计算值。
 *
 * 运行：node scripts/verify-board-frame-color.mjs [baseUrl]
 * 隔离：夹具课件、Agent 不调、daemon socket 只拦不转发——不碰真课件库与实时会话。
 */

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5';
const record = {
  id: ID, title: '外框颜色验证', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['A = (1, 2)', 'B = (3, 2)', 'f = Segment(A, B)'], messages: [],
  view: { showAxes: true, showGrid: true },
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(30_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/agent**', (route) => {
  assert.equal(route.request().method(), 'GET', 'no model invocation');
  return route.fulfill({ json: { runtimes: [] } });
});
await page.route('**/api/byok', (route) => route.fulfill({ json: { apiKeyConfigured: false } }));
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

const frameStyle = (page) => page.evaluate(() => {
  const el = document.querySelector('.GeoGebraFrame');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
    color: cs.borderTopColor,
    inline: el.getAttribute('style') ?? '',
  };
});

try {
  await page.goto(`${base}/dashboard?history_id=${ID}`, { timeout: 90_000 });
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForTimeout(1200);

  const baseline = await frameStyle(page);
  assert.ok(baseline, 'applet 外框存在');
  assert.equal(baseline.border, '1px solid rgb(211, 211, 211)', `平时是 1px 浅灰（实测 ${baseline.border}）`);

  // 关键一步：模拟 GeoGebra 把行内颜色改成别的（现场见过纯黑）。样式表必须仍然赢。
  await page.evaluate(() => { document.querySelector('.GeoGebraFrame').style.borderColor = 'rgb(0, 0, 0)'; });
  await page.waitForTimeout(200);
  const forced = await frameStyle(page);
  assert.match(forced.inline, /border-color:\s*rgb\(0,\s*0,\s*0\)/, '前置：行内确实被改成了黑色');
  assert.equal(forced.color, 'rgb(211, 211, 211)',
    `行内被改黑之后，画板外框仍是浅灰（实测 ${forced.color}——不钉死的话这里会是纯黑）`);

  // 再模拟一次"拖入文件"时的红色，同样不该漏出来
  await page.evaluate(() => { document.querySelector('.GeoGebraFrame').style.borderColor = 'rgb(255, 0, 0)'; });
  await page.waitForTimeout(200);
  assert.equal((await frameStyle(page)).color, 'rgb(211, 211, 211)', '行内被改红之后也仍是浅灰');

  assert.deepEqual(errors, []);
  console.log('PASS: 画板外框颜色钉死 —— 平时 1px 浅灰；行内被改成黑/红时样式表仍然赢（不会被 GeoGebra 的内部状态改色）；0 浏览器错误。');
} finally {
  await browser.close();
}
