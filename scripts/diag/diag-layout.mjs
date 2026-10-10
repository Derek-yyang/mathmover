import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  '--disable-features=LocalNetworkAccessChecks','--allow-insecure-localhost']});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto('http://localhost:3000/agent', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(20000);

const layout = await p.evaluate(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    header: box(document.querySelector('header')),
    textarea: box(document.querySelector('textarea')),
    canvas: box(document.querySelector('canvas')),
    h1: document.querySelector('h1')?.textContent ?? null,
    h2: document.querySelector('h2')?.textContent ?? null,
    bodyChildren: [...document.body.querySelectorAll('#__next > * , main > *')].length,
  };
});
console.log('布局:', JSON.stringify(layout, null, 2));

// 分块截图便于目视
await p.screenshot({ path: 'spike-out/e2e/panel-right.png', clip: { x: 980, y: 0, width: 420, height: 900 } });
await p.screenshot({ path: 'spike-out/e2e/panel-top.png', clip: { x: 0, y: 0, width: 1400, height: 80 } });
console.log('裁剪图 → spike-out/e2e/panel-right.png, panel-top.png');
await b.close();
