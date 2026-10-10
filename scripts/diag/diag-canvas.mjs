import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  '--disable-features=LocalNetworkAccessChecks','--allow-insecure-localhost']});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto('http://localhost:3000/agent', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(25000);
const info = await p.evaluate(() => {
  const cs = [...document.querySelectorAll('canvas')];
  return {
    canvasCount: cs.length,
    canvases: cs.map(c => ({
      w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight,
      parent: c.parentElement?.className?.toString?.().slice(0,40) ?? null,
      grandparent: c.parentElement?.parentElement?.id ?? c.parentElement?.parentElement?.className?.toString?.().slice(0,40) ?? null,
      inGgbEl: !!c.closest('#ggb-element'),
      inGgb: !!c.closest('#ggb'),
      inFrame: !!c.closest('.GeoGebraFrame'),
      inAppletParams: !!c.closest('.appletParameters'),
    })),
    ggbElement: !!document.querySelector('#ggb-element'),
    bridgeKeys: Object.keys(window).filter(k => k.includes('mm') || k.includes('MM')),
  };
});
console.log(JSON.stringify(info, null, 2));
// 直接试 toDataURL
const t = await p.evaluate(() => {
  const cs = [...document.querySelectorAll('canvas')];
  return cs.map((c,i) => {
    try { const u = c.toDataURL('image/png'); return { i, ok: true, len: u.length }; }
    catch(e) { return { i, ok: false, err: String(e).slice(0,100) }; }
  });
});
console.log('toDataURL:', JSON.stringify(t));
await b.close();
