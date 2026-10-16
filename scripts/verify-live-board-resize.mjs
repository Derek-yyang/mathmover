import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1544, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [], ok: true } }));
  await page.route('**/api/agent', route => route.fulfill({ json: { runtimes: [] } }));
  await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.close());
  await stubConstructionDraft(page);
  await page.goto((process.argv[2] || 'http://localhost:3000') + '/dashboard');
  await page.waitForFunction(() => !!window.ggbApplet?.getViewProperties, null, { timeout: 90000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const api = window.ggbApplet; api.evalCommand('A=(1,2)');
    window.__resizeCalls = [];
    const original = api.setSize;
    api.setSize = function(w,h) { const start = performance.now(); const result = original.call(this,w,h);
      window.__resizeCalls.push({ width: w, height: h, start, duration: performance.now()-start }); return result; };
  });
  const measure = () => page.evaluate(() => {
    const container = document.querySelector('#ggb-element'), stage = container.parentElement;
    const v = JSON.parse(window.ggbApplet.getViewProperties(1));
    return { stageWidth: stage.clientWidth, width: document.querySelector('.GeoGebraFrame').getBoundingClientRect().width,
      centerX: v.xMin+v.width*v.invXscale/2, centerY: v.yMin+v.height*v.invYscale/2, scale: v.invXscale };
  });
  const before = await measure();
  const separator = page.getByRole('separator', { name: '调整聊天区宽度' });
  const box = await separator.boundingBox();
  await page.mouse.move(box.x+box.width/2, box.y+box.height/2); await page.mouse.down();
  for (let i=1; i<=18; i++) { await page.mouse.move(box.x+box.width/2-i*8, box.y+box.height/2); await page.waitForTimeout(20); }
  // Still holding the pointer: resize must already have followed the drag.
  const during = await measure();
  const dragCalls = await page.evaluate(() => window.__resizeCalls.length);
  assert(dragCalls >= 3, 'board waited until pointer release');
  assert(Math.abs(during.width-before.width) > 50, 'board did not follow moving boundary');
  await page.mouse.up(); await page.waitForTimeout(150);
  const after = await measure();
  assert(Math.abs(after.width-after.stageWidth) <= 2, 'final width mismatch');
  assert(Math.abs(after.centerX-before.centerX) < .01 && Math.abs(after.centerY-before.centerY) < .01, 'center drift');
  assert(Math.abs(after.scale-before.scale) < .0001, 'scale drift');
  await page.evaluate(() => window.__resizeCalls = []);
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.waitForTimeout(320);
  const collapsed = await measure();
  const collapseCalls = await page.evaluate(() => window.__resizeCalls);
  assert(collapseCalls.length >= 2, 'collapse updated only after transition');
  assert(Math.abs(collapsed.width-collapsed.stageWidth) <= 2);
  assert(Math.abs(collapsed.centerX-before.centerX) < .01);
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  await page.waitForTimeout(320);
  const expanded = await measure(); assert(Math.abs(expanded.width-expanded.stageWidth) <= 2);
  assert(await page.evaluate(() => window.ggbApplet.exists('A')), 'construction lost');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ duringDragUpdates: dragCalls, dragWidthChange: during.width-before.width,
    collapseUpdates: collapseCalls.length, finalSizeAligned: true, centerAndScalePreserved: true, errors }));
} finally { await browser.close(); }
