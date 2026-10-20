/**
 * 诊断：把文件拖到**画板上**时那道红框是谁画的。
 *
 * 做法：拖入前后各截一张画布，并把画布里"红得可疑"的元素/计算样式打出来。
 * 若红框是 GeoGebra 自己在 canvas 里画的，PNG 会变、DOM 里不会有节点。
 *
 * 运行：node scripts/diag-canvas-drop-red.mjs [baseUrl]
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';
const record = {
  id: ID, title: '拖放红框诊断', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['A = (1, 2)', 'B = (3, 2)', 'f = Segment(A, B)'], messages: [],
  view: { showAxes: true, showGrid: true },
};

await mkdir('spike-out', { recursive: true });
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

const redScan = (page) => page.evaluate(() => {
  const isRed = (value) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value || '');
    return !!m && +m[1] > 150 && +m[2] < 90 && +m[3] < 90;
  };
  const hits = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const props = ['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'backgroundColor', 'color'];
    const red = props.filter((p) => isRed(cs[p]));
    if (!red.length) continue;
    // 只留"整块都是红边/红底"的，文字颜色不算
    if (red.every((p) => p === 'color')) continue;
    const r = el.getBoundingClientRect();
    hits.push({ tag: el.tagName, id: el.id, cls: String(el.className ?? '').slice(0, 70), red: red.join(','), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return { hits: hits.slice(0, 12), total: hits.length, canvases: document.querySelectorAll('canvas').length };
});

try {
  await page.goto(`${base}/dashboard?history_id=${ID}`, { timeout: 90_000 });
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForTimeout(1500);


const frame = () => page.evaluate(() => {
  const el = document.querySelector('.GeoGebraFrame');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    cls: el.className,
    inline: el.getAttribute('style') ?? '',
    border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
    outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
    bg: cs.backgroundColor,
  };
});
console.log('拖动前 frame:', JSON.stringify(await frame()));
  const board = page.locator('[aria-label=数学课件画布]');
  const box = await board.boundingBox();
  const before = await page.evaluate(() => window.ggbApplet.getPNGBase64(1, false));
  await board.screenshot({ path: 'spike-out/canvas-drop-before.png' });

  // 用一张**真**PNG（上面那版塞的是 64 个零字节，GeoGebra 会直接丢掉，测不出松手后果）
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    c.getContext('2d').fillRect(0, 0, 48, 48);
    return c.toDataURL('image/png').split(',')[1];
  });
  const dt = await page.evaluateHandle((base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], '题图.png', { type: 'image/png' }));
    return dt;
  }, png);
  // 事件必须落在 applet **里面**的元素上：GeoGebra 的拖放监听挂在自家容器上，
  // 在外层元素上 dispatch 不会往下走，什么都不会发生（第一版就这么白跑了一遍）。
  const canvas = board.locator('canvas').first();
  await canvas.dispatchEvent('dragenter', { dataTransfer: dt, bubbles: true });
  await canvas.dispatchEvent('dragover', { dataTransfer: dt, bubbles: true });
  await page.waitForTimeout(900);

  const after = await page.evaluate(() => window.ggbApplet.getPNGBase64(1, false));
  await board.screenshot({ path: 'spike-out/canvas-drop-during.png' });
  console.log('拖动中 frame:', JSON.stringify(await frame()));
  const scan = await redScan(page);
  console.log('画板框:', JSON.stringify(box));
  console.log('拖动中 PNG 是否变化:', before !== after, `(before ${before.length} / after ${after.length})`);
  console.log('红色元素:', JSON.stringify(scan, null, 1));

  // 关键问题：松手会不会真的把图插进构造里
  const before2 = await page.evaluate(() => ({ n: window.ggbApplet.getObjectNumber(), xml: window.ggbApplet.getXML().length }));
  await canvas.dispatchEvent('drop', { dataTransfer: dt, bubbles: true });
  await page.waitForTimeout(1500);
  const after2 = await page.evaluate(() => ({ n: window.ggbApplet.getObjectNumber(), xml: window.ggbApplet.getXML().length }));
  const objectsBefore = before2.n, objectsAfter = after2.n;
  if (objectsAfter !== objectsBefore) {
    const names = await page.evaluate(() => window.ggbApplet.getAllObjectNames().slice(-6));
    console.log('新增对象:', JSON.stringify(names), `XML 长度 ${before2.xml} → ${after2.xml}`);
  }
  await board.screenshot({ path: 'spike-out/canvas-drop-after.png' });
  console.log(`松手后对象数: ${objectsBefore} → ${objectsAfter}`);

  // 第二阶段：丢一个**.ggb**（GeoGebra 自己的文件格式）——这才是红框真正预告的能力
  const ggb = await page.evaluate(() => new Promise((resolve) => window.ggbApplet.getBase64(resolve)));
  const beforeGgb = await page.evaluate(() => ({ n: window.ggbApplet.getObjectNumber(), xml: window.ggbApplet.getXML().length }));
  const dtGgb = await page.evaluateHandle((base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], '别的课件.ggb', { type: 'application/vnd.geogebra.file' }));
    return dt;
  }, ggb);
  await canvas.dispatchEvent('dragenter', { dataTransfer: dtGgb, bubbles: true });
  await canvas.dispatchEvent('dragover', { dataTransfer: dtGgb, bubbles: true });
  await page.waitForTimeout(300);
  await canvas.dispatchEvent('drop', { dataTransfer: dtGgb, bubbles: true });
  await page.waitForTimeout(2000);
  const afterGgb = await page.evaluate(() => ({ n: window.ggbApplet.getObjectNumber(), xml: window.ggbApplet.getXML().length }));
  console.log(`丢 .ggb 后: 对象 ${beforeGgb.n} → ${afterGgb.n}，XML ${beforeGgb.xml} → ${afterGgb.xml}`);

  // 对照：同一拖拽在**对话区**上，画板 PNG 应该一动不动
  const chat = page.locator('[aria-label="题目图片放置区"]');
  const dt2 = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(64)], '题图2.png', { type: 'image/png' }));
    return dt;
  });
  const pngBeforeChat = await page.evaluate(() => window.ggbApplet.getPNGBase64(1, false));
  await chat.dispatchEvent('dragenter', { dataTransfer: dt2 });
  await chat.dispatchEvent('dragover', { dataTransfer: dt2 });
  await page.waitForTimeout(700);
  const pngDuringChat = await page.evaluate(() => window.ggbApplet.getPNGBase64(1, false));
  console.log('对话区上拖动时画板 PNG 是否变化:', pngBeforeChat !== pngDuringChat);
} finally {
  await browser.close();
}
