/**
 * 评价用：把某份 3D 稿子在净室画布上按宿主真路径下发，回报「这图到底长什么样」的客观量。
 *
 * 读三样：相机（scale/朝向）、可见世界范围（`getCorner(3,·)`）、对象数与 PNG 字节数。
 *
 * 运行：node scripts/diag-3d-framing-quality.mjs <draftPath> [baseUrl]
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const draftPath = process.argv[2];
if (!draftPath) { console.error('用法: node scripts/diag-3d-framing-quality.mjs <draftPath> [baseUrl]'); process.exit(1); }
const base = process.argv[3] || 'http://localhost:3000';
const ID = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
const commands = readFileSync(draftPath, 'utf8').split(/\r?\n/).map((s) => s.trimEnd()).filter((s) => s.trim());
const record = {
  id: ID, title: '取景评价', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['MODE: 2D', 'O = (0,0)'], messages: [], view: { showAxes: true, showGrid: true },
};

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

try {
  await page.goto(`${base}/dashboard`);
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.getByRole('button', { name: '取景评价', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForFunction(() => !!window.__mmGgb, null, { timeout: 30_000 });
  await page.waitForTimeout(1200);

  const r = await page.evaluate(async (cmds) => {
    const timeout = new Promise((res) => setTimeout(() => res({ __timeout: true }), 60_000));
    return Promise.race([window.__mmGgb.apply({ commands: cmds, incremental: false }), timeout]);
  }, commands);
  if (r?.__timeout) console.log('⚠ apply 超时');
  await page.waitForTimeout(2500);

  const info = await page.evaluate(`(function(){
    const api = window.ggbApplet;
    const block = /<euclidianView3D>[\\s\\S]*?<\\/euclidianView3D>/.exec(api.getXML())?.[0] ?? '';
    const coord = /<coordSystem([^>]*)\\/?>/.exec(block)?.[1] ?? '';
    const a = {}; for (const m of coord.matchAll(/(\\w+)="([^"]*)"/g)) a[m[1]] = m[2];
    const corners = [1,2,3,4].map((n) => { try { return api.getCorner(3, n); } catch (e) { return 'throw'; } });
    const canvas = (() => { const c = document.querySelector('[aria-label=数学课件画布] canvas'); return c ? { w: c.width, h: c.height } : null; })();
    return {
      scale: Number(a.scale), xAngle: Number(a.xAngle), zAngle: Number(a.zAngle),
      xZero: Number(a.xZero), yZero: Number(a.yZero), zZero: Number(a.zZero),
      corners, canvas,
      objects: api.getObjectNumber(),
      png: api.getPNGBase64(1, false)?.length ?? null,
      axes: [...block.matchAll(/<axis id="\\d" show="(\\w+)"/g)].map((m) => m[1]).join(''),
      grid: /<evSettings[^>]*grid="(\\w+)"/.exec(block)?.[1] ?? null,
    };
  })()`);

  console.log(JSON.stringify(info, null, 1));
  const c = info.corners.filter((x) => Array.isArray(x));
  if (c.length) {
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
    console.log(`可见范围（角点）：x ${Math.min(...xs).toFixed(2)} … ${Math.max(...xs).toFixed(2)}`
      + `  y ${Math.min(...ys).toFixed(2)} … ${Math.max(...ys).toFixed(2)}`);
  }
  // 落一张图：评价「好不好看」最直接的办法就是看一眼
  const shot = await page.evaluate('window.ggbApplet.getPNGBase64(1, false)');
  mkdirSync('spike-out', { recursive: true });
  writeFileSync('spike-out/framing-quality.png', Buffer.from(shot, 'base64'));
  console.log('已写出 spike-out/framing-quality.png');
} finally {
  await browser.close();
}
