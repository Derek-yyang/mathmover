/**
 * 诊断：3D 稿子的取景为什么会叠成一片白。
 *
 * 两个场景对照（同一份稿子、同一个干净起点）：
 *   A. 只跑一遍（宿主 `execList` 的第一遍）
 *   B. 跑一遍 + 对「返回 false 的命令」重跑一次（宿主 300ms 后的第二遍）
 * 每个场景都等视图更新落定（GeoGebra 的视图命令是**异步**生效的，立刻读会读到旧值）
 * 再读相机与 PNG 字节数——字节数是「是不是一片白」的代理量。
 *
 * 净室：夹具课件 + 拦掉 /api/coursewares、/api/construction、daemon socket 只拦不转发。
 * 运行：node scripts/diag-3d-zoom.mjs [baseUrl] [draftPath]
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

// 与 verify-3d-framing-not-retried.mjs 同一份稿子的取景尾部：一份「一遍正常、
// 两遍放大三倍」的 3D 稿。给了路径参数就用那个文件（排查现场草稿时方便）。
const inlineDraft = ['MODE: 3D', 'A = (0, 0, 0)', 'B = (2, 0, 0)', 'C = (2, 2, 0)', 'D = (0, 2, 0)',
  'A1 = (0, 0, 2)', 'B1 = (2, 0, 2)', 'C1 = (2, 2, 2)', 'D1 = (0, 2, 2)',
  ...['AB', 'BC', 'CD', 'DA', 'A1B1', 'B1C1', 'C1D1', 'D1A1', 'AA1', 'BB1', 'CC1', 'DD1'].map((n) => `e${n} = Segment(${n[0]}, ${n.slice(1)})`),
  'CenterView((1, 1, 1))', 'SetViewDirection((1, -1, 1))', 'ZoomIn(3)'];
const commands = process.argv[3]
  ? readFileSync(process.argv[3], 'utf8').split(/\r?\n/).map((s) => s.trimEnd()).filter((s) => s.trim())
  : inlineDraft;
const record = {
  id: ID, title: '缩放诊断', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['MODE: 2D', 'O = (0,0)', 'E = Ellipse(O, 3, 2)'],
  messages: [], view: { showAxes: true, showGrid: true },
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
  await page.getByRole('button', { name: '缩放诊断', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForTimeout(1200);

  const run = (cmds, { retry }) => page.evaluate(async ({ cmds, retry }) => {
    const api = window.ggbApplet;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const cam = () => {
      const block = /<euclidianView3D>[\s\S]*?<\/euclidianView3D>/.exec(api.getXML())?.[0] ?? '';
      const coord = /<coordSystem([^>]*)\/?>/.exec(block)?.[1] ?? '';
      const a = {};
      for (const m of coord.matchAll(/(\w+)="([^"]*)"/g)) a[m[1]] = m[2];
      return { scale: Number(a.scale), xAngle: Number(a.xAngle), zAngle: Number(a.zAngle) };
    };
    const ready = () => /view id="512"[^>]*visible="true"/.test(api.getPerspectiveXML());

    // 复刻宿主：清屏 → 切 3D 透视 → 等就绪
    api.newConstruction();
    api.setPerspective('T');
    api.setAxesVisible(true, true, true);
    for (let i = 0; i < 40 && !ready(); i++) await wait(100);
    await wait(500);
    const start = cam();

    const failed = [];
    for (const cmd of cmds) {
      let ok;
      try { ok = api.evalCommand(cmd.replace(/\\"/g, '"')); } catch { ok = 'throw'; }
      if (ok === false) failed.push(cmd);
    }
    await wait(1200);
    const afterFirst = { ...cam(), png: api.getPNGBase64(1, false)?.length ?? null };

    let afterRetry = null;
    if (retry) {
      await wait(300);
      for (const cmd of failed) { try { api.evalCommand(cmd.replace(/\\"/g, '"')); } catch {} }
      await wait(1200);
      afterRetry = { ...cam(), png: api.getPNGBase64(1, false)?.length ?? null };
    }
    return { start, afterFirst, afterRetry, failedCount: failed.length, failed };
  }, { cmds, retry });

  const body = commands.filter((c) => !c.trim().startsWith('MODE:'));

  const a = await run(body, { retry: false });
  console.log('起始相机        :', JSON.stringify(a.start));
  console.log('A 只跑一遍      :', JSON.stringify(a.afterFirst));
  console.log('  返回 false 的 :', a.failedCount, '条');
  console.log('  取景三条的返回值:', JSON.stringify(a.failed.filter((c) => /Zoom|CenterView|SetViewDirection/i.test(c))));

  const b = await run(body, { retry: true });
  console.log('\nB 一遍 + 重跑    :', JSON.stringify(b.afterRetry));
  console.log('  起始            :', JSON.stringify(b.start), '→ 一遍后', JSON.stringify(b.afterFirst));

  console.log('\n取景行:', body.filter((c) => /^\s*(ZoomIn|ZoomOut|CenterView|SetViewDirection)\s*\(/i.test(c)).join(' | '));
} finally {
  await browser.close();
}
