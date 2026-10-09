import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  '--disable-features=LocalNetworkAccessChecks','--allow-insecure-localhost']});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('console', m => console.log('  [page]', m.type(), m.text().slice(0,200)));
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,250)));
await p.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i=0;i<25;i++) await p.waitForTimeout(1000);
const st = await p.evaluate(() => ({
  appletReadyCalled: !!window.__mmDebugAppletReady,
  hasBridge: !!window.__mmGgb,
  bridgeType: typeof window.__mmGgb,
  wsGlobals: Object.keys(window).filter(k => /mm|MM/i.test(k)),
  canvases: document.querySelectorAll('canvas').length,
}));
console.log('  状态:', JSON.stringify(st));
await b.close();
