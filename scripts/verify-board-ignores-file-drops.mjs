/**
 * 画板**不吃文件拖放**的回归。
 *
 * 守什么：文件经过 GeoGebra applet 时，它会把 `.GeoGebraFrame` 的**行内** border-color
 * 从 `rgb(211,211,211)` 改成 `rgb(255,0,0)`（它自带的「文件丢这里」提示），而实际上
 * 松手什么都不做（真 PNG / 真 .ggb 都不改变对象数与构造 XML）。那道红框与对话区的拖入区
 * 互相矛盾，所以在 capture 阶段吃掉：
 *   ① 拖文件经过画板时外框**始终是灰的**（红框不亮）；
 *   ② 松手不改变画布（对象数、构造 XML 都不变）；
 *   ③ 也不会漏进右边对话区变成附件；
 *   ④ 但**只拦文件**——页面内拖选文字照旧能到画板上（别把整块区域的拖拽都吃掉）。
 *
 * 运行：node scripts/verify-board-ignores-file-drops.mjs [baseUrl]
 * 隔离：夹具课件、Agent 不调、daemon socket 只拦不转发——不碰真课件库与实时会话。
 */

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
const record = {
  id: ID, title: '画板拖放验证', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['A = (1, 2)', 'B = (3, 2)', 'f = Segment(A, B)'],
  messages: [], view: { showAxes: true, showGrid: true },
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(30_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/agent**', (route) => {
  assert.equal(route.request().method(), 'GET', 'no model invocation');
  return route.fulfill({ json: { runtimes: [{ id: 'fixture', name: '测试 Agent', usable: true, version: 'fixture', canAttachImages: true }] } });
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

/** applet 外框的边框颜色——红框就是它。 */
const frameBorder = (page) => page.evaluate(() => {
  const el = document.querySelector('.GeoGebraFrame');
  return el ? getComputedStyle(el).borderTopColor : null;
});
/** 在画布 canvas 上挂一个一次性监听，回报事件有没有到达目标（被 capture 吃掉就到不了）。 */
const armProbe = (page) => page.evaluate(() => {
  window.__dropProbe = null;
  const target = document.querySelector('[aria-label=数学课件画布] canvas');
  target.addEventListener('dragenter', (event) => {
    window.__dropProbe = { type: event.type, prevented: event.defaultPrevented };
  }, { once: true });
});
const readProbe = (page) => page.evaluate(() => window.__dropProbe);

const state = (page) => page.evaluate(() => ({
  objects: window.ggbApplet.getObjectNumber(),
  xml: window.ggbApplet.getXML().length,
  chips: document.querySelectorAll('[aria-label=待发送图片] img').length,
}));

try {
  await page.goto(`${base}/dashboard?history_id=${ID}`, { timeout: 90_000 });
  await page.waitForFunction(() => !!window.ggbApplet?.getXML, null, { timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));
  await page.waitForTimeout(1200);

  const baselineBorder = await frameBorder(page);
  assert.equal(baselineBorder, 'rgb(211, 211, 211)', `前置：平时外框是浅灰（实测 ${baselineBorder}）`);
  const before = await state(page);
  const canvas = page.locator('[aria-label=数学课件画布] canvas').first();
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    c.getContext('2d').fillRect(0, 0, 48, 48);
    return c.toDataURL('image/png').split(',')[1];
  });
  const fileTransfer = () => page.evaluateHandle((base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], '题图.png', { type: 'image/png' }));
    return dt;
  }, png);

  // ① 拖文件经过画板：外框不许变红
  const dt = await fileTransfer();
  await armProbe(page);
  await canvas.dispatchEvent('dragenter', { dataTransfer: dt, bubbles: true });
  await canvas.dispatchEvent('dragover', { dataTransfer: dt, bubbles: true });
  await page.waitForTimeout(600);
  const duringBorder = await frameBorder(page);
  assert.equal(duringBorder, baselineBorder, `拖文件经过画板时外框不该变红（实测 ${duringBorder}）`);
  assert.equal(await readProbe(page), null, '文件拖拽被 capture 吃掉，到不了画布');

  // ② 松手不改变画布，③ 也不漏进对话区
  await canvas.dispatchEvent('drop', { dataTransfer: dt, bubbles: true });
  await page.waitForTimeout(1200);
  const after = await state(page);
  assert.deepEqual(after, before, `松手后画布与附件都不该变（${JSON.stringify(before)} → ${JSON.stringify(after)}）`);

  // ④ 只拦文件：页面内拖文字照旧能到画板上
  await armProbe(page);
  await canvas.dispatchEvent('dragenter', {
    dataTransfer: await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '画板里选中的一段文字');
      return dt;
    }),
    bubbles: true,
  });
  const textProbe = await readProbe(page);
  assert(textProbe, '非文件拖拽不该被吃掉（到不了画布就说明拦过头了）');
  assert.equal(textProbe.prevented, false, '非文件拖拽不该被 preventDefault');

  assert.deepEqual(errors, []);
  console.log('PASS: 画板不吃文件拖放 —— 拖动中与松手后外框始终浅灰、对象数与构造 XML 不变、没漏成附件；非文件拖拽仍能到达画板；0 浏览器错误。');
} finally {
  await browser.close();
}
