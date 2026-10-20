/**
 * 探针：3D 坐标轴的开关到底该用哪个形式的 API / 命令。
 *
 * 代码库里两种写法并存（`useGgbSession` 用 `setAxesVisible(true,true,true)` 三参、
 * `useGgbGraphics` 用 `setAxesVisible(3,show,show,show)` 四参）——至少要有一个是错的。
 * 逐个试，每次读完 `<euclidianView3D>` 里三个 `<axis>` 的 show 位。
 *
 * 运行：node scripts/diag-3d-axes-api.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0';
const record = {
  id: ID, title: '轴API探针', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['MODE: 3D', 'A = (0,0,0)', 'B = (2,2,2)'], messages: [],
  view: { showAxes: true, showGrid: true },
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
  await page.getByRole('button', { name: '轴API探针', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForTimeout(2000);

  const out = await page.evaluate(async () => {
    const api = window.ggbApplet;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const axes = () => {
      const block = /<euclidianView3D>[\s\S]*?<\/euclidianView3D>/.exec(api.getXML())?.[0] ?? '';
      const flags = [...block.matchAll(/<axis id="\d" show="(\w+)"/g)].map((m) => m[1]);
      return flags.length ? flags.map((f) => (f === 'true' ? '1' : '0')).join('') : '(无 3D 块/轴)';
    };
    const log = [];
    const step = async (label, fn) => { try { fn(); } catch (e) { log.push([label, 'throw:' + e.message]); return; } await wait(900); log.push([label, axes()]); };

    log.push(['起始', axes()]);
    await step('setAxesVisible(false,false,false)', () => api.setAxesVisible(false, false, false));
    await step('setAxesVisible(true,true,true)', () => api.setAxesVisible(true, true, true));
    await step('setAxesVisible(3,false,false,false)', () => api.setAxesVisible(3, false, false, false));
    await step('setAxesVisible(3,true,true,true)', () => api.setAxesVisible(3, true, true, true));
    await step('evalCommand ShowAxes(3,false)', () => api.evalCommand('ShowAxes(3, false)'));
    await step('evalCommand ShowAxes(3,true)', () => api.evalCommand('ShowAxes(3, true)'));
    await step('setAxesVisible(true,true)', () => api.setAxesVisible(true, true));
    return log;
  });

  console.log('xyz 三位 = 三个轴的 show 位\n');
  for (const [label, value] of out) console.log(`  ${String(value).padEnd(16)} ← ${label}`);
} finally {
  await browser.close();
}
