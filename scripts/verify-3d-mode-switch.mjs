/**
 * 回归守卫：「2D 画布上增量下发 3D 稿」必须切到三维视图。
 *
 * 背景（2026-10-18 实测）：daemon 的增量判定是「新账本是不是当前账本的纯追加」，而**空画布 +
 * 任何新账本**都算纯追加。于是「新建课件 / ggb_reset 之后的第一份 3D 稿」被判成**增量**，
 * 页面的 3D 视图设置（setPerspective('T') / 轴 / 网格 / 相机）整段被跳过 → 透视没切 →
 * 3D 对象只在三维视图里画（style XML 里 `ev="4"`）→ **用户看到整块白屏、而 kernel 里对象都在**。
 *
 * 判据：增量下发后 3D 视图就绪位（透视 XML 里 view 512）必须转 true、相机必须回标准、
 * 画面必须真的画出东西（实测有内容 ≥ ~48KB，全白只有几百字节）。
 *
 * 运行：node scripts/verify-3d-mode-switch.mjs [baseUrl]
 * 隔离：课件接口是夹具、Agent 不调、daemon socket 只拦不转发——不碰真课件库与实时会话。
 */

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const record = {
  id: ID, title: '2D转3D守卫', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['A = (0, 0)', 'B = (1, 0)', 'C = (1, 1)', 'D = (0, 1)', 'quad = Polygon(A, B, C, D)'],
  messages: [], view: { showAxes: true, showGrid: true },
};
const LEDGER_3D = ['MODE: 3D', 'A = (0, 0, 0)', 'B = A + (1, 0, 0)', 'C = A + (1, 1, 0)', 'D = A + (0, 1, 0)',
  'A1 = A + (0, 0, 1)', 'B1 = B + (0, 0, 1)', 'C1 = C + (0, 0, 1)', 'D1 = D + (0, 0, 1)',
  'eAB = Segment(A, B)', 'eBC = Segment(B, C)', 'eCD = Segment(C, D)', 'eDA = Segment(D, A)',
  'eA1B1 = Segment(A1, B1)', 'eB1C1 = Segment(B1, C1)', 'eC1D1 = Segment(C1, D1)', 'eD1A1 = Segment(D1, A1)',
  'eAA1 = Segment(A, A1)', 'eBB1 = Segment(B, B1)', 'eCC1 = Segment(C, C1)', 'eDD1 = Segment(D, D1)'];

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
  await page.getByRole('button', { name: '2D转3D守卫', exact: true }).click();
  await page.getByRole('button', { name: '重命名课件：2D转3D守卫', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForTimeout(1000);

  const probe = () => page.evaluate(() => {
    const api = window.ggbApplet;
    const xml = api.getXML();
    const block = /<euclidianView3D>[\s\S]*?<\/euclidianView3D>/.exec(xml);
    const coord = block ? /<coordSystem([^>]*)\/?>/.exec(block[0])?.[1] ?? '' : '';
    return {
      objects: api.getAllObjectNames().length,
      view512: /view id="512"[^>]*visible="(\w+)"/.exec(api.getPerspectiveXML())?.[1] ?? null,
      scale: /scale="([^"]*)"/.exec(coord)?.[1] ?? null,
      pngBytes: (() => { try { return api.getPNGBase64(1, false).length; } catch { return -1; } })(),
    };
  });

  // 起点：2D 课件，视图确实是二维
  const twoD = await probe();
  assert.equal(twoD.view512, 'false', `the 2D courseware starts in the 2D view (got ${JSON.stringify(twoD)})`);

  // 复刻现场：先清屏（agent 换模式时的第一步），再**增量**下发 3D 稿
  await page.evaluate(() => window.__mmGgb.reset());
  await page.waitForTimeout(400);
  await page.evaluate(async (ledger) => { await window.__mmGgb.apply({ commands: ledger, ledger, incremental: true }); }, LEDGER_3D);
  await page.waitForTimeout(1200);

  const threeD = await probe();
  assert.equal(threeD.view512, 'true', `an incremental 3D ledger still switches to the 3D view (got ${JSON.stringify(threeD)})`);
  assert.equal(threeD.scale, '50', 'and the camera is standard (so the ledger framing is reproducible)');
  assert.ok(threeD.objects >= 20, `the ledger's objects landed (got ${threeD.objects})`);
  assert.ok(threeD.pngBytes > 20_000, `and the canvas really renders (got ${threeD.pngBytes} PNG bytes; full-white is only a few hundred)`);

  assert.deepEqual(errors, []);
  console.log('PASS: 2D 画布上增量下发 3D 稿会切到三维视图、相机回标准、画面真的渲染出来；0 浏览器错误。');
} finally { await browser.close(); }
