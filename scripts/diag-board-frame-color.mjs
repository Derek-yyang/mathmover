/**
 * 诊断：画板外框什么时候变成**深色/黑色**。
 *
 * 上一轮查清了红框是 GeoGebra applet 在文件拖入时改的**行内** border-color。
 * 这一轮查另一种：聚焦/失焦、以及拖动之后，`.GeoGebraFrame` 的边框、阴影、类名各是什么。
 *
 * 运行：node scripts/diag-board-frame-color.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2';
const record = {
  id: ID, title: '外框颜色诊断', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['A = (1, 2)', 'B = (3, 2)', 'f = Segment(A, B)'], messages: [],
  view: { showAxes: true, showGrid: true },
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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

const snap = (label) => page.evaluate((tag) => {
  const el = document.querySelector('.GeoGebraFrame');
  if (!el) return { tag, missing: true };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const active = document.activeElement;
  return {
    tag,
    cls: el.className,
    inline: el.getAttribute('style') ?? '',
    border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
    shadow: cs.boxShadow,
    outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    focus: active ? `${active.tagName.toLowerCase()}.${String(active.className ?? '').slice(0, 40)}` : null,
  };
}, label);

try {
  await page.goto(`${base}/dashboard?history_id=${ID}`, { timeout: 90_000 });
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForTimeout(1200);
  console.log(JSON.stringify(await snap('① 刚打开'), null, 1));

  // 在画布上点一下（用户最常做的动作：拖一下/点一下画板）
  const canvas = page.locator('[aria-label=数学课件画布] canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  console.log(JSON.stringify(await snap('② 点了画布之后'), null, 1));

  // 再点一下右边对话区，看会不会退回去
  await page.mouse.click(1150, 400);
  await page.waitForTimeout(600);
  console.log(JSON.stringify(await snap('③ 焦点移出画板之后'), null, 1));
} finally {
  await browser.close();
}
