import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
  '--disable-features=LocalNetworkAccessChecks','--allow-insecure-localhost']});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('console', m => { const t=m.text(); if (/\[mm\]/.test(t)) console.log('  [page]', t.slice(0,180)); });
p.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,200)));
await p.goto('http://localhost:3000/dashboard', { waitUntil:'domcontentloaded', timeout:60000 });
for (let i=0;i<45;i++){ await p.waitForTimeout(1000); if (await p.evaluate(()=>!!window.__mmGgb)) { console.log('  桥就绪, 第', i+1, 's'); break; } }
const r = await fetch('http://127.0.0.1:8788/api/apply', {
  method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({ commands: ['A = (0,0)','B = (3,2)','f = Line(A,B)'] }),
}).then(x=>x.json()).catch(e=>({error:String(e)}));
console.log('  daemon 返回:', JSON.stringify(r).slice(0,200));
await b.close();
