/**
 * 诊断：后续轮次**只重发部分取景行**会怎样。
 *
 * 现场（2026-10-19 真实会话，`library.sqlite` 的 rev 37 → rev 58）：
 *   rev 37（画长方体）尾部：`CenterView` + `SetViewDirection` + `ZoomIn(1.8)`
 *   rev 58（加动点 P）尾部：`CenterView` + `SetViewDirection`（**ZoomIn 没了**）
 * 而宿主「见到取景行就先把相机回标准」⇒ 只重发一半 = 缩放被抹掉。
 *
 * 三个场景对照：
 *   A. 全量下发 rev 37          → 期望 scale 90（50 × 1.8）
 *   B. 再增量下发 rev 58 的尾巴（含 CenterView/SetViewDirection，无 ZoomIn）→ 看 scale
 *   C. 换一条**完全不含取景行**的尾巴增量 → 看 scale（应该保持不动）
 *
 * 运行：node scripts/diag-3d-partial-framing.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2';
const record = {
  id: ID, title: '半截取景诊断', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['MODE: 2D', 'O = (0,0)'], messages: [], view: { showAxes: true, showGrid: true },
};

const head = ['MODE: 3D', 'ShowGrid(3, true)', 'ShowAxes(3, true)',
  'A = (0, 0, 0)', 'SetFixed(A, true)',
  'vx = (4, 0, 0)', 'vy = (0, 3, 0)', 'vz = (0, 0, 3)',
  'SetVisibleInView(vx, 3, false)', 'SetVisibleInView(vy, 3, false)', 'SetVisibleInView(vz, 3, false)',
  'B = A + vx', 'D = A + vy', 'C = A + vx + vy', 'A1 = A + vz', 'B1 = B + vz', 'C1 = C + vz', 'D1 = D + vz',
  'eAB = Segment(A, B)', 'eBC = Segment(B, C)', 'eCD = Segment(C, D)', 'eDA = Segment(D, A)',
  'eA1B1 = Segment(A1, B1)', 'eB1C1 = Segment(B1, C1)', 'eC1D1 = Segment(C1, D1)', 'eD1A1 = Segment(D1, A1)',
  'eAA1 = Segment(A, A1)', 'eBB1 = Segment(B, B1)', 'eCC1 = Segment(C, C1)', 'eDD1 = Segment(D, D1)',
  'CenterView((2, 1.5, 1.5))', 'SetViewDirection((2, -3, 2))', 'ZoomIn(1.8)'];
// rev 58 真实新增的那几行：动点 P + 两个取景行（没有 ZoomIn）
const partialTail = ['P = Point(eAB)', 'SetColor(P, "Red")', 'SetPointSize(P, 6)', 'ShowLabel(P, true)',
  'SetLabelMode(P, 0)', 'CenterView((2, 1.5, 1.5))', 'SetViewDirection((2, -3, 2))'];
// 对照：同样的新增，但**一个取景行都不写**
const noFramingTail = ['P = Point(eAB)', 'SetColor(P, "Red")', 'SetPointSize(P, 6)', 'ShowLabel(P, true)', 'SetLabelMode(P, 0)'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(20_000);
await page.route('**/api/agent**', (r) => r.fulfill({ json: { runtimes: [] } }));
await page.route('**/api/byok', (r) => r.fulfill({ json: { apiKeyConfigured: false } }));
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

const apply = (page, cmds, incremental, ledger) => page.evaluate(async ({ c, inc, led }) => {
  const timeout = new Promise((res) => setTimeout(() => res({ __timeout: true }), 60_000));
  return Promise.race([window.__mmGgb.apply({ commands: c, incremental: inc, ledger: led }), timeout]);
}, { c: cmds, inc: incremental, led: ledger });
const scale = (page) => page.evaluate(`(function(){
  const block = /<euclidianView3D>[\\s\\S]*?<\\/euclidianView3D>/.exec(window.ggbApplet.getXML())?.[0] ?? '';
  const a = {}; for (const m of (/<coordSystem([^>]*)\\/?>/.exec(block)?.[1] ?? '').matchAll(/(\\w+)="([^"]*)"/g)) a[m[1]] = m[2];
  return { scale: Number(a.scale), xZero: Number(a.xZero), zZero: Number(a.zZero) };
})()`);

try {
  await page.goto(`${base}/dashboard`);
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.getByRole('button', { name: '半截取景诊断', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForFunction(() => !!window.__mmGgb, null, { timeout: 30_000 });
  await page.waitForTimeout(1200);

  await apply(page, head, false);
  await page.waitForTimeout(2000);
  const a = await scale(page);
  console.log('A 全量 rev37（含 ZoomIn(1.8)）      :', JSON.stringify(a), ' 期望 scale≈90');

  // B：增量下发 rev58 的尾巴（含 CenterView/SetViewDirection、无 ZoomIn）
  await apply(page, partialTail, true, [...head, ...partialTail]);
  await page.waitForTimeout(2000);
  const b = await scale(page);
  console.log('B 增量 + 半截取景（无 ZoomIn）      :', JSON.stringify(b), ' ← 缩放被抹掉？');

  // 回到 A 的状态再测对照
  await apply(page, head, false);
  await page.waitForTimeout(2000);
  const a2 = await scale(page);
  await apply(page, noFramingTail, true, [...head, ...noFramingTail]);
  await page.waitForTimeout(2000);
  const c = await scale(page);
  console.log('C 增量 + 完全不写取景行             :', JSON.stringify(c), ` （起点 ${a2.scale}，应保持不变）`);
} finally {
  await browser.close();
}
