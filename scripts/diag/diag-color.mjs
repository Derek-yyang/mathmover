import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  '--disable-features=LocalNetworkAccessChecks','--allow-insecure-localhost']});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto('http://localhost:3000/agent', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 60; i++) { await p.waitForTimeout(1000);
  const r = await fetch('http://127.0.0.1:8788/api/health').then(x=>x.json()).catch(()=>null);
  if (r?.canvasConnected) break; }
await fetch('http://127.0.0.1:8788/api/reset', { method: 'POST' });
await p.waitForTimeout(800);
await fetch('http://127.0.0.1:8788/api/apply', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ commands: [
    'A = (0, 0)', 'B = (3, 2)', 'f = Line(A, B)', 'g = Function(x^2 / 4, -3, 3)',
    'SetColor(f, "#FF0000")', 'SetLineThickness(g, 5)' ] }),
});
await p.waitForTimeout(1200);
const out = await p.evaluate(() => {
  const api = window.ggbApplet;
  const hex = (n) => typeof n === 'number' ? '#' + n.toString(16).padStart(6, '0') : String(n);
  return {
    f_color: hex(api.getColor('f')),
    g_color: hex(api.getColor('g')),
    f_thickness: api.getLineThickness?.('f'),
    g_thickness: api.getLineThickness?.('g'),
  };
});
console.log('颜色/线宽:', JSON.stringify(out, null, 2));
await p.screenshot({ path: 'spike-out/e2e/color-check.png', clip: { x: 0, y: 64, width: 980, height: 836 } });
await b.close();
