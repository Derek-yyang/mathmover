/**
 * GO/NO-GO spike：headless Chromium 里 GeoGebra classic applet 能否稳定出 PNG？
 *
 * 背景：MathMover 的「读写不对称」契约要求模型能**看见画布**（结构摘要 + 画布 PNG + 上轮 audit）。
 * 若 headless 下 PNG 三级兜底全废，该契约失守，需改设计。本 spike 一次性回答：
 *
 *   Q1  api.exportPNG 是否存在？签名是什么？
 *   Q2  exportPNG 能否真的出图？尺寸？是否空白（软渲染常见坑）？
 *   Q3  三级兜底各自可用性：applet-export / host-screenshot / 全废
 *   Q4  实测 api 方法面（对照 math-mover-next/components/dashboard/types.ts 的声明是否属实）
 *   Q5  swiftshader 软渲染下 2D 渲染是否正确（坐标/网格/线条）
 *
 * 运行：npm run spike:ggb-png
 * 退出码：0 = go（PNG 可用）；2 = degraded（仅截屏兜底）；3 = no-go（全废）
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('spike-out');
const GGB_SRC = 'https://www.geogebra.org/apps/deployggb.js';

// 与 GeoGebraBoard.tsx 的 applet 参数**逐字段一致**——spike 结论要能代表生产路径
const APPLET_PARAMS = {
  appName: 'classic',
  perspective: '2',
  width: 900,
  height: 600,
  showToolBar: false,
  showAlgebraInput: false,
  showMenuBar: false,
  errorDialogsActive: false,
  useBrowserForScale: false,
  showAxes: true,
  showGrid: true,
};

// 一个最小但有代表性的构造：定点、动点、直线、函数
const DEMO_COMMANDS = [
  'A = (0, 0)',
  'B = (3, 2)',
  'f = Line(A, B)',
  'C = (1, 4)',
  'g = Function(x^2 / 4, -3, 3)',
  'D = Point(f, 0.5)',
  'slider_t = 2',
];

const report = {
  q1_exportPNG: { exists: false, typeof: null, arity: null },
  q2_exportPNG: { ok: false, error: null, dataUrlLen: 0, width: 0, height: 0, nonBlank: null, sample: null },
  q3_fallbacks: { appletExport: false, hostScreenshot: false, verdict: null },
  q4_apiSurface: { present: [], missing: [], unexpected: [] },
  q5_render2d: { objectsCreated: 0, expected: 0, objectTypes: {}, sliderDetected: null },
  timeline: {},
  environment: { headless: true, gl: null, userAgent: null },
};

function log(...a) { console.log('[spike]', ...a); }

/** 判断 PNG 是否为空白图：比较采样像素的方差（全空白/全黑则方差≈0） */
async function pngStats(page, dataUrl) {
  return await page.evaluate(async (url) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const step = 8;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0, sum = 0, sumSq = 0, min = 255, max = 0;
    const buckets = new Set();
    for (let y = 0; y < c.height; y += step) {
      for (let x = 0; x < c.width; x += step) {
        const i = (y * c.width + x) * 4;
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        sum += lum; sumSq += lum * lum; n++;
        if (lum < min) min = lum;
        if (lum > max) max = lum;
        buckets.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
      }
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    return {
      width: c.width, height: c.height,
      meanLuma: +mean.toFixed(2),
      variance: +variance.toFixed(3),
      minLuma: +min.toFixed(1), maxLuma: +max.toFixed(1),
      distinctColorBuckets: buckets.size,
    };
  }, dataUrl);
}

const HARNESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>MathMover GGB spike</title>
<style>html,body{margin:0;padding:0;background:#FDFCF8}
#ggb{width:900px;height:600px}</style></head>
<body><div id="ggb"></div></body></html>`;

const t0 = Date.now();
const mark = (k) => { report.timeline[k] = Date.now() - t0; };

let browser;
try {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  log('launching browser (angle/swiftshader for real canvas compositing)...');
  // 优先系统浏览器：免下载、免 headless-shell 二进制。
  // Playwright 的 headless:true 走 chrome-headless-shell（另一个下载），
  // 而系统 Chrome/Edge 用自带的 --headless=new，行为更接近用户所见。
  const launchArgs = [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--headless=new',
  ];
  const CANDIDATES = [
    { name: 'chrome', channel: 'chrome' },
    { name: 'msedge', channel: 'msedge' },
    {
      name: 'chrome-explicit',
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    },
    {
      name: 'msedge-explicit',
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    },
    { name: 'playwright-chromium', channel: undefined },
  ];
  let launchTarget = null;
  const launchErrors = [];
  for (const cand of CANDIDATES) {
    try {
      const opts = { headless: true, args: launchArgs };
      if (cand.channel) opts.channel = cand.channel;
      if (cand.executablePath) opts.executablePath = cand.executablePath;
      // headless:true + channel 时不要再叠 --headless=new（重复）
      if (cand.channel || cand.executablePath) {
        opts.args = launchArgs.filter((a) => a !== '--headless=new');
      }
      browser = await chromium.launch(opts);
      launchTarget = cand.name;
      report.environment.browser = cand.name;
      log('使用浏览器:', cand.name);
      break;
    } catch (e) {
      launchErrors.push(`${cand.name}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  if (!browser) {
    throw new Error('所有浏览器候选都启动失败:\n  ' + launchErrors.join('\n  '));
  }
  mark('browserLaunched');

  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') log('page.error:', m.text().slice(0, 200)); });
  page.on('pageerror', (e) => log('pageexception:', String(e).slice(0, 200)));

  // 本地 harness，避免 file:// 的 CORS/模块限制
  await page.route('**/mm-harness.html', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HARNESS_HTML }));
  await page.goto('http://127.0.0.1/mm-harness.html');
  report.environment.userAgent = await page.evaluate(() => navigator.userAgent);
  mark('harnessLoaded');

  log('injecting deployggb.js from CDN:', GGB_SRC);
  await page.addScriptTag({ url: GGB_SRC, timeout: 60_000 });
  const hasGGBApplet = await page.evaluate(() => typeof window.GGBApplet !== 'undefined');
  if (!hasGGBApplet) throw new Error('window.GGBApplet 未定义 —— deployggb.js 注入失败（网络/CDN？）');
  mark('ggbScriptLoaded');
  log('window.GGBApplet 已就位');

  // 注入 applet，与 GeoGebraBoard.tsx 同构
  const ready = await page.evaluate(async (params) => {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('appletOnLoad 30s 超时')), 30_000);
      const p = Object.assign({}, params, {
        appletOnLoad: (api) => { clearTimeout(timeout); window.__api = api; resolve(true); },
      });
      const el = document.getElementById('ggb');
      el.innerHTML = '';
      const applet = new window.GGBApplet(p, true);
      applet.inject(el);
    });
  }, APPLET_PARAMS).catch((e) => { throw new Error('applet 注入失败: ' + e.message); });

  if (!ready) throw new Error('appletOnLoad 未触发');
  mark('appletLoaded');
  log('appletOnLoad 已触发');

  // ---------- Q4: API 方法面实测 ----------
  const PROBE = [
    'evalCommand', 'evalCommandGetLabels', 'getAllObjectNames', 'getObjectType',
    'getValueString', 'getValue', 'setValue', 'isIndependent',
    'getMin', 'getMax', 'getStep', 'getCaption',
    'newConstruction', 'setPerspective', 'setAxesVisible', 'setGridVisible',
    'registerUpdateListener', 'unregisterUpdateListener',
    'getViewProperties', 'refreshViews', 'recalcDisplay',
    'getBase64', 'setBase64', 'exportPNG',
  ];
  const surface = await page.evaluate((names) => {
    const api = window.__api;
    const present = [], missing = [];
    for (const n of names) {
      const t = typeof api?.[n];
      if (t === 'function' || t !== 'undefined') present.push(`${n}:${t}`);
      else missing.push(n);
    }
    const unexpected = Object.keys(api || {}).filter((k) => !names.includes(k)).slice(0, 40);
    return { present, missing, unexpected };
  }, PROBE);
  report.q4_apiSurface = surface;
  log('API 方法面 present =', surface.present.length, ' missing =', surface.missing.join(',') || '(无)');

  // ---------- Q5: 执行构造并体检 ----------
  const execResult = await page.evaluate((commands) => {
    const api = window.__api;
    const failed = [];
    for (const cmd of commands) {
      try {
        const ok = api.evalCommand(cmd);
        if (ok === false) failed.push(cmd);
      } catch (e) { failed.push(`${cmd} :: ${e}`); }
    }
    const names = api.getAllObjectNames() || [];
    const types = {};
    for (const n of names) {
      try { types[n] = api.getObjectType(n); } catch { types[n] = '?'; }
    }
    // 滑块探测（复刻 useGgbSession.detectSliders 语义）
    const sliders = [];
    for (const n of names) {
      try {
        if (api.getObjectType(n) === 'numeric' && api.isIndependent(n)) {
          sliders.push({ name: n, value: api.getValue(n) });
        }
      } catch {}
    }
    return { failed, names, types, sliders, count: names.length };
  }, DEMO_COMMANDS);
  mark('commandsExecuted');

  report.q5_render2d = {
    objectsCreated: execResult.count,
    expected: DEMO_COMMANDS.length,
    objectTypes: execResult.types,
    sliderDetected: execResult.sliders,
  };
  log('对象数 =', execResult.count, ' 期望 =', DEMO_COMMANDS.length);
  log('失败行 =', execResult.failed.length ? execResult.failed : '(无)');
  log('滑块探测 =', JSON.stringify(execResult.sliders));

  await page.evaluate(() => { window.__api.refreshViews(); window.__api.recalcDisplay?.(); });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(600);
  mark('viewRefreshed');

  // ---------- Q1/Q2: exportPNG ----------
  report.q1_exportPNG.exists = await page.evaluate(() => typeof window.__api.exportPNG === 'function');
  report.q1_exportPNG.typeof = await page.evaluate(() => typeof window.__api.exportPNG);
  report.q1_exportPNG.arity = await page.evaluate(() => (window.__api.exportPNG ? window.__api.exportPNG.length : null));
  log('Q1 exportPNG: exists =', report.q1_exportPNG.exists, ' typeof =', report.q1_exportPNG.typeof, ' arity =', report.q1_exportPNG.arity);

  if (report.q1_exportPNG.exists) {
    try {
      const dataUrl = await page.evaluate(() => new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('exportPNG 5s 超时')), 5000);
        try {
          window.__api.exportPNG((b64) => {
            clearTimeout(to);
            // GeoGebra 不同版本回传 dataURL 或纯 base64，两种都接
            resolve(String(b64 || '').startsWith('data:') ? b64 : 'data:image/png;base64,' + b64);
          });
        } catch (e) { clearTimeout(to); reject(e); }
      }));
      const stats = await pngStats(page, dataUrl);
      report.q2_exportPNG = {
        ok: true, error: null,
        dataUrlLen: dataUrl.length,
        width: stats.width, height: stats.height,
        nonBlank: stats.variance > 1,
        sample: stats,
      };
      fs.writeFileSync(path.join(OUT_DIR, 'png-applet-export.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
      log('Q2 exportPNG 成功:', JSON.stringify(stats));
    } catch (e) {
      report.q2_exportPNG.error = String(e.message || e);
      log('Q2 exportPNG 失败:', report.q2_exportPNG.error);
    }
  }

  // ---------- Q3: 兜底通道 host screenshot ----------
  try {
    const el = await page.$('#ggb');
    const buf = await el.screenshot();
    fs.writeFileSync(path.join(OUT_DIR, 'png-host-screenshot.png'), buf);
    // 用 PNG 头解析尺寸
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    report.q3_fallbacks.hostScreenshot = true;
    report.q3_fallbacks.hostScreenshotSize = { width: w, height: h, bytes: buf.length };
    log('Q3 host screenshot 成功:', w, 'x', h, buf.length, 'bytes');
  } catch (e) {
    report.q3_fallbacks.hostScreenshotError = String(e.message || e);
    log('Q3 host screenshot 失败:', report.q3_fallbacks.hostScreenshotError);
  }

  report.q3_fallbacks.appletExport = report.q2_exportPNG.ok && report.q2_exportPNG.nonBlank === true;

  if (report.q3_fallbacks.appletExport) report.q3_fallbacks.verdict = 'GO: applet-export 可用且非空白';
  else if (report.q3_fallbacks.hostScreenshot) report.q3_fallbacks.verdict = 'DEGRADED: 仅宿主截屏兜底可用';
  else report.q3_fallbacks.verdict = 'NO-GO: 三级兜底全废，画布 PNG 感知契约失守';

  // getBase64（备用通道，类型声明里有）
  try {
    const b64 = await page.evaluate(() => new Promise((res) => window.__api.getBase64(res)));
    report.q3_fallbacks.getBase64Len = (b64 || '').length;
    if (b64) {
      const u = b64.startsWith('data:') ? b64 : 'data:image/png;base64,' + b64;
      const stats = await pngStats(page, u);
      report.q3_fallbacks.getBase64Stats = stats;
      fs.writeFileSync(path.join(OUT_DIR, 'png-getbase64.png'), Buffer.from(u.split(',')[1], 'base64'));
    }
    log('getBase64 len =', report.q3_fallbacks.getBase64Len, JSON.stringify(report.q3_fallbacks.getBase64Stats || {}));
  } catch (e) {
    report.q3_fallbacks.getBase64Error = String(e.message || e);
  }

  mark('done');
} catch (e) {
  report.fatal = String(e && e.stack || e);
  log('FATAL:', report.fatal);
} finally {
  await browser?.close().catch(() => {});
}

report.timeline.total = Date.now() - t0;
fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));

console.log('\n==================== SPINE REPORT ====================');
console.log('Q1 exportPNG :', JSON.stringify(report.q1_exportPNG));
console.log('Q2 png 出图  :', JSON.stringify(report.q2_exportPNG));
console.log('Q3 兜底裁定  :', report.q3_fallbacks.verdict);
console.log('   getBase64 :', report.q3_fallbacks.getBase64Len ?? 'n/a', JSON.stringify(report.q3_fallbacks.getBase64Stats || {}));
console.log('Q4 API 缺失  :', report.q4_apiSurface.missing.join(',') || '(无)');
console.log('Q5 构造对象  :', report.q5_render2d.objectsCreated, '/', report.q5_render2d.expected, '滑块', JSON.stringify(report.q5_render2d.sliderDetected));
console.log('timeline     :', JSON.stringify(report.timeline));
console.log('输出目录     :', OUT_DIR);
if (report.fatal) console.log('FATAL        :', report.fatal);
console.log('======================================================');

const code = report.fatal ? 1
  : report.q3_fallbacks.appletExport ? 0
  : report.q3_fallbacks.hostScreenshot ? 2
  : 3;
process.exit(code);
