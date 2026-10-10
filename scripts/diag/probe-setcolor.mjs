import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-features=LocalNetworkAccessChecks'] });
const p = await b.newPage();
await p.route('**/h.html', r => r.fulfill({ status: 200, contentType: 'text/html',
  body: '<!doctype html><body><div id="ggb" style="width:600px;height:400px"></div></body>' }));
await p.goto('http://127.0.0.1/h.html');
await p.addScriptTag({ url: 'https://www.geogebra.org/apps/deployggb.js', timeout: 60000 });
const out = await p.evaluate(async () => {
  await new Promise((res) => new window.GGBApplet({ appName:'classic', perspective:'2', width:600, height:400,
    showToolBar:false, showAlgebraInput:false, showMenuBar:false, errorDialogsActive:false,
    useBrowserForScale:false, appletOnLoad:(api)=>{ window.__api=api; res(); } }, true)
    .inject(document.getElementById('ggb')));
  const api = window.__api;
  api.evalCommand('A = (0,0)');
  api.evalCommand('B = (3,2)');
  api.evalCommand('f = Line(A,B)');

  const id = (n) => n;
  const before = api.getColor('f');
  const r1 = api.evalCommand('SetColor(f, "#FF0000")');
  const after1 = api.getColor('f');
  const r2 = api.evalCommand('SetColor(f, 0xFF0000)');
  const after2 = api.getColor('f');
  // 直接 API
  let directErr = null;
  try { api.setColor('f', 255, 0, 0); } catch (e) { directErr = String(e).slice(0,80); }
  const afterDirect = api.getColor('f');

  // thickness / label 有没有对应直接方法
  const probes = {};
  for (const n of ['setLineThickness','getLineThickness','setLabelVisible','setLabelStyle',
                   'setCaption','getCaption','setVisible','getVisible','setTrace',
                   'setPointStyle','setFilling','evalCommandGetLabels']) {
    probes[n] = typeof api[n];
  }

  return {
    before: before,
    eval_SetColor_hex: { returned: r1, colorAfter: after1, changed: after1 !== before },
    eval_SetColor_int: { returned: r2, colorAfter: after2, changed: after2 !== before },
    api_setColor: { colorAfter: afterDirect, changed: afterDirect !== before, err: directErr },
    apiProbes: probes,
  };
});
console.log(JSON.stringify(out, null, 2));
await b.close();
