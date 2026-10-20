/**
 * 诊断：一份 3D 稿子「全量下发」在画板上到底要多久。
 *
 * 现场（2026-10-20「正方体动点多选题」）：前 8 次 apply 都 2~5 秒，之后连续两次
 * **全量** apply 撞满 60 秒的 APPLY_TIMEOUT，夹在中间的 getState 也全撞 20 秒——
 * 说明画板主线程被一次超长的全量重建占住了。最后一次成功的全量 apply 用了 49.5 秒。
 *
 * 这里在净室里按宿主真路径跑同一份稿子，把「全量 apply / 再全量 / getState」逐次计时，
 * 看这份构造是不是真的这么贵。
 *
 * 运行：node scripts/diag-apply-cost.mjs <draftPath> [baseUrl]
 */

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const draftPath = process.argv[2];
if (!draftPath) { console.error('用法: node scripts/diag-apply-cost.mjs <draftPath> [baseUrl]'); process.exit(1); }
const base = process.argv[3] || 'http://localhost:3000';
const ID = 'e7e7e7e7-e7e7-4e7e-8e7e-e7e7e7e7e7e7';
const commands = readFileSync(draftPath, 'utf8').split(/\r?\n/).map((s) => s.trimEnd()).filter((s) => s.trim());
const record = {
  id: ID, title: '下发成本诊断', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['MODE: 2D', 'O = (0,0)'], messages: [], view: { showAxes: true, showGrid: true },
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.setDefaultTimeout(180_000);
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

try {
  await page.goto(`${base}/dashboard?history_id=${ID}`, { timeout: 90_000 });
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForFunction(() => !!window.__mmGgb, null, { timeout: 30_000 });
  await page.waitForTimeout(1200);

  console.log(`稿子: ${commands.length} 行`);
  const cmds = JSON.stringify(commands);
  for (const label of ['① 首次全量 apply', '② 再次全量 apply']) {
    const r = await page.evaluate(async ({ label, c }) => {
      const t0 = performance.now();
      await window.__mmGgb.apply({ commands: JSON.parse(c), incremental: false });
      return { label, ms: Math.round(performance.now() - t0) };
    }, { label, c: cmds });
    console.log(`  ${r.label}: ${(r.ms / 1000).toFixed(1)} s`);
  }

  const gs = await page.evaluate(async () => {
    const t0 = performance.now();
    const n = window.ggbApplet.getObjectNumber();
    // 模拟 getState 里最贵的那几步
    const xml = window.ggbApplet.getXML();
    const t1 = performance.now();
    window.ggbApplet.getPNGBase64(1, false);
    const t2 = performance.now();
    return { objects: n, xmlMs: Math.round(t1 - t0), pngMs: Math.round(t2 - t1), xmlLen: xml.length };
  });
  console.log('  对象数:', gs.objects, '| getXML:', gs.xmlMs + 'ms (' + gs.xmlLen + ' 字节)', '| getPNGBase64:', gs.pngMs + 'ms');
} finally {
  await browser.close();
}
