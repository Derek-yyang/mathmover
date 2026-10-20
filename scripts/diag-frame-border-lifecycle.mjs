/**
 * 诊断：`.GeoGebraFrame` 的行内 `border-color` 会不会在某些操作之后**丢掉**。
 *
 * 假设：外框的浅灰来自 applet 参数 `borderColor` 写进**行内** style 的那一行；
 * 一旦某次操作把行内 style 重写掉、少了 `border-color`，边框就退回 CSS 默认
 * （`border: 1px solid` + currentColor）⇒ **黑线**。用户截图里那道黑线正好在
 * 画板外框的位置（x=256 / y=57），外侧还有 1px 浅灰，和这个假设吻合。
 *
 * 逐步跑几个会重排画板的操作，每一步都读一次行内 style 与计算值。
 *
 * 运行：node scripts/diag-frame-border-lifecycle.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4';
const record = {
  id: ID, title: '外框生命周期', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['A = (1, 2)', 'B = (3, 2)', 'f = Segment(A, B)'], messages: [],
  view: { showAxes: true, showGrid: true },
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
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

const read = (label) => page.evaluate((tag) => {
  const el = document.querySelector('.GeoGebraFrame');
  const cs = getComputedStyle(el);
  const style = el.getAttribute('style') ?? '';
  return {
    tag,
    hasBorderColorInline: /border-color/i.test(style),
    computed: cs.borderTopColor,
    inline: style,
  };
}, label);

const report = async (label) => {
  const r = await read(label);
  const flag = r.computed === 'rgb(211, 211, 211)' ? '✔ 浅灰' : `✘ ${r.computed}`;
  console.log(`${flag}  ${label}`);
  if (!r.hasBorderColorInline) console.log(`      行内已无 border-color: ${r.inline}`);
  return r;
};

try {
  await page.goto(`${base}/dashboard?history_id=${ID}`, { timeout: 90_000 });
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForFunction(() => !!window.__mmGgb, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await report('① 刚打开');

  const step = async (label, fn) => { await fn(); await page.waitForTimeout(900); await report(label); };

  // setSize 是宿主 resize 走的那条路（`resizeAppletPreservingView`），GeoGebra 会重写外框行内样式
  const size = await page.evaluate(() => {
    const r = document.querySelector('.geogebra-stage').getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  await step('①b setSize(w-64, h-64)', () => page.evaluate((s) => window.ggbApplet.setSize(s.w - 64, s.h - 64), size));
  await step('①c setSize(恢复原尺寸)', () => page.evaluate((s) => window.ggbApplet.setSize(s.w, s.h), size));

  await step('② newConstruction()', () => page.evaluate(() => window.ggbApplet.newConstruction()));
  await step('③ setPerspective(\'T\')', () => page.evaluate(() => window.ggbApplet.setPerspective('T')));
  await step('④ setPerspective(\'G\')', () => page.evaluate(() => window.ggbApplet.setPerspective('G')));
  await step('⑤ 宿主 apply 一份 2D 稿', () => page.evaluate(async () => {
    await window.__mmGgb.apply({ commands: ['MODE: 2D', 'A = (0, 0)', 'B = (2, 1)', 'f = Segment(A, B)'], incremental: false });
  }));
  await step('⑥ setBase64 恢复（带 3D 视图）', () => page.evaluate(async () => {
    const b64 = await new Promise((res) => window.ggbApplet.getBase64(res));
    await new Promise((res) => window.ggbApplet.setBase64(b64, res));
  }));
  await step('⑦ 再次 setPerspective(\'T\')', () => page.evaluate(() => window.ggbApplet.setPerspective('T')));
} finally {
  await browser.close();
}
