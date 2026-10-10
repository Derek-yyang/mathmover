import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  '--disable-features=LocalNetworkAccessChecks','--allow-insecure-localhost']});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('console', m => { const t = m.text(); if (/mm|apply|bridge|执行|error/i.test(t)) console.log('  [page]', t.slice(0,220)); });
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,220)));
await p.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i=0;i<40;i++){ await p.waitForTimeout(1000);
  const r = await fetch('http://127.0.0.1:8788/api/health').then(x=>x.json()).catch(()=>null);
  if (r?.canvasConnected) { console.log('  画布已连上，第', i+1, 's'); break; } }

// 直接在页面里调桥，绕过 WebSocket，看 executeCommands 本身会不会挂
const t0 = Date.now();
const direct = await p.evaluate(async () => {
  const b = window.__mmGgb;
  if (!b) return { error: 'no bridge on window' };
  const timer = new Promise(r => setTimeout(() => r({ timeout: true }), 12000));
  const work = b.apply(['A = (0,0)', 'B = (3,2)', 'f = Line(A,B)']);
  return Promise.race([work, timer]);
});
console.log(`  页面内直接调桥 apply：耗时 ${Date.now()-t0}ms`, JSON.stringify(direct).slice(0, 300));
await b.close();
