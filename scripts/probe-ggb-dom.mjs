import { chromium } from 'playwright';
import fs from 'node:fs';

const b = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1100, height: 800 } });
await p.route('**/mm-h.html', r => r.fulfill({ status: 200, contentType: 'text/html',
  body: '<!doctype html><body><div id="ggb" style="width:900px;height:600px"></div></body>' }));
await p.goto('http://127.0.0.1/mm-h.html');
await p.addScriptTag({ url: 'https://www.geogebra.org/apps/deployggb.js', timeout: 60000 });

await p.evaluate(async () => {
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 30000);
    new window.GGBApplet({ appName: 'classic', perspective: '2', width: 900, height: 600,
      showToolBar: false, showAlgebraInput: false, showMenuBar: false, errorDialogsActive: false,
      useBrowserForScale: false, showAxes: true, showGrid: true,
      appletOnLoad: (api) => { clearTimeout(t); window.__api = api; res(); } }, true)
      .inject(document.getElementById('ggb'));
  });
  const api = window.__api;
  // 显式开轴与网格（生产路径 useGgbSession:121-133 会调，spike 上一轮漏了）
  api.setAxesVisible(true, true);
  api.setGridVisible(true);
  api.evalCommand('A=(0,0)'); api.evalCommand('B=(3,2)');
  api.evalCommand('f=Line(A,B)'); api.evalCommand('g=Function(x^2/4,-3,3)');
  api.evalCommand('D=Point(f,0.5)');
  api.refreshViews();
});
await p.waitForTimeout(900);

const out = await p.evaluate(() => {
  const cs = [...document.querySelectorAll('#ggb canvas')];
  return cs.map((c, i) => {
    try {
      const u = c.toDataURL('image/png');
      return { i, ok: true, len: u.length, w: c.width, h: c.height, dataUrl: u };
    } catch (e) { return { i, ok: false, err: String(e).slice(0, 100) }; }
  });
});

fs.mkdirSync('spike-out', { recursive: true });
for (const o of out) {
  if (o.ok && o.dataUrl) {
    fs.writeFileSync(`spike-out/png-canvas-${o.i}.png`, Buffer.from(o.dataUrl.split(',')[1], 'base64'));
    console.log(`canvas[${o.i}] toDataURL OK  ${o.w}x${o.h}  ${o.len} chars  → spike-out/png-canvas-${o.i}.png`);
  } else {
    console.log(`canvas[${o.i}] FAILED:`, o.err);
  }
}
console.log('canvas 总数:', out.length, '| svg:', await p.evaluate(() => document.querySelectorAll('#ggb svg').length));
await b.close();
