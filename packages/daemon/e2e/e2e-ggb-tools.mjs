/**
 * 端到端验收：真实浏览器 + 真实 GeoGebra + 真实桥接代码 + 真实工具层。
 *
 * 首要验收（开工时定的）：
 *   `ggb_get_state` 能读回 {commands, objects, sliders, png}
 *
 * 链路：  本测试 → GgbTools → GgbBridgeClient ←WebSocket→ 页面桥 → GeoGebra applet
 *
 * 真实性保证：
 *   - 桥接代码用 esbuild 打包 **math-mover-next/lib/ggb-bridge.ts 本体**，不是副本
 *   - GeoGebra 走真实 CDN 加载
 *   - GgbTools / GgbBridgeClient 是 daemon 用的同一份实现
 *
 * 运行：node packages/daemon/e2e/e2e-ggb-tools.mjs
 * 退出码：0 = 验收通过
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GgbBridgeClient } from '../src/bridge-client.ts';
import { GgbTools, buildBoardState, writeConstructionFile, DEFAULT_TOOLS_CONFIG } from '../src/tools.ts';
import { diffCommands } from '@mathmover/ggb-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = path.join(ROOT, 'spike-out', 'e2e');
const WS_PORT = 8792;
const WORKDIR = path.join(OUT, 'workdir');

const DEMO_COMMANDS = [
  'MODE:2D',
  'A = (0, 0)',
  'B = (3, 2)',
  'f = Line(A, B)',
  'g = Function(x^2 / 4, -3, 3)',
  'D = Point(f, 0.5)',
  'slider_t = 2',
  'SetColor(f, "#FF0000")',
];

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  fs.mkdirSync(WORKDIR, { recursive: true });

  // ── 1. 打包**真实**桥接代码 ────────────────────────────────────
  const bridgeSrc = path.join(ROOT, 'math-mover-next', 'lib', 'ggb-bridge.ts');
  const bridgeOut = path.join(OUT, 'bridge.bundle.js');
  // 用 esbuild JS API（跨平台）；npx 在 Windows 上是 .cmd，execFileSync 起不来
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [bridgeSrc],
    bundle: true,
    format: 'iife',
    globalName: 'MMGGB',
    outfile: bridgeOut,
    logLevel: 'warning',
  });
  console.log('已打包真实桥接代码 →', path.relative(ROOT, bridgeOut));

  // ── 2. 起工具层（daemon 内部就是这么接的） ────────────────────
  const bridge = new GgbBridgeClient({ port: WS_PORT, host: '127.0.0.1' });
  await bridge.start();
  const tools = new GgbTools(bridge, { ...DEFAULT_TOOLS_CONFIG, workdir: WORKDIR, includePng: true });

  // ── 3. 起浏览器 + GeoGebra，挂真实桥 ───────────────────────────
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      // Chrome 的 Local Network Access 检查会拦掉页面 → ws://127.0.0.1 的连接。
      // 这是浏览器策略问题，不是我们的实现问题；Electron 可在主进程显式放开。
      '--disable-features=LocalNetworkAccessChecks',
      '--allow-insecure-localhost',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  page.on('console', (m) => console.log(`  [page:${m.type()}]`, m.text().slice(0, 300)));
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));

  await page.route('**/mm-e2e.html', (r) => r.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><body>
      <div id="ggb" style="width:900px;height:600px"></div>
      <script src="/bridge.bundle.js"></script>
    </body>`,
  }));
  await page.route('**/bridge.bundle.js', (r) =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(bridgeOut, 'utf-8') }));

  await page.goto('http://127.0.0.1/mm-e2e.html');
  await page.addScriptTag({ url: 'https://www.geogebra.org/apps/deployggb.js', timeout: 60_000 });

  await page.evaluate(async (wsPort) => {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('appletOnLoad 超时')), 40000);
      new window.GGBApplet({
        appName: 'classic', perspective: '2', width: 900, height: 600,
        showToolBar: false, showAlgebraInput: false, showMenuBar: false,
        errorDialogsActive: false, useBrowserForScale: false,
        showAxes: true, showGrid: true,
        appletOnLoad: (api) => {
          clearTimeout(t);
          window.__ledger = [];
          window.MMGGB.attachGgbBridge(api, {
            getLedger: () => window.__ledger,
            onLedgerChange: (cmds) => { window.__ledger = cmds; },
            wsUrl: `ws://127.0.0.1:${wsPort}`,
          });
          res(true);
        },
      }, true).inject(document.getElementById('ggb'));
    });
  }, WS_PORT);

  // 等页面桥连上来
  for (let i = 0; i < 40 && !bridge.connected; i++) await new Promise((r) => setTimeout(r, 250));
  check('页面桥已连上 daemon', bridge.connected);

  // ── 4. ggb_apply：全量写入 ────────────────────────────────────
  const applied = await tools.apply(DEMO_COMMANDS);
  check('ggb_apply 执行完成', applied.applied.length >= 7,
    `applied=${applied.applied.length} failed=${applied.failedFirstPass.length}`
    + (applied.failedFirstPass.length ? '  未成功行: ' + JSON.stringify(applied.failedFirstPass) : ''));
  check('ggb_apply 返回 diff', Array.isArray(applied.diff.entries),
    applied.diff.summary);

  // ── 5. ggb_get_state：首要验收 ────────────────────────────────
  const s = await tools.getState();

  check('返回 commands[]（真源）', Array.isArray(s.commands) && s.commands.length === DEMO_COMMANDS.length,
    `${s.commands.length} 行`);
  check('返回 objects[]', s.objects.length >= 5,
    s.objects.map((o) => o.name).join(','));
  check('返回 sliders[]', s.sliders.some((x) => x.name === 'slider_t'),
    JSON.stringify(s.sliders));
  check('返回 png（画布截图）', typeof s.png.base64 === 'string' && s.png.base64.length > 500,
    `base64 ${s.png.base64?.length ?? 0} chars, source=${s.png.source}`);

  const pngBuf = s.png.base64 ? Buffer.from(s.png.base64, 'base64') : null;
  if (pngBuf) {
    fs.writeFileSync(path.join(OUT, 'get-state.png'), pngBuf);
    const w = pngBuf.readUInt32BE(16), h = pngBuf.readUInt32BE(20);
    check('PNG 是有效图片', pngBuf.slice(1, 4).toString() === 'PNG' && w > 100,
      `${w}x${h}, ${pngBuf.length} bytes → spike-out/e2e/get-state.png`);
  }

  check('体检无发现（构造正常）', s.audit.findings.length === 0,
    s.audit.findings.length ? JSON.stringify(s.audit.findings) : '');
  check('MODE:2D 被识别', s.mode === '2D');

  // ── 6. diff（apply 内部用来「说清改了什么」）────────────────────
  const v2 = DEMO_COMMANDS.map((c) => (c.includes('Point(f, 0.5)') ? 'D = Point(f, 0.75)' : c));
  const d = diffCommands(DEMO_COMMANDS, v2);
  check('diff 抓到 D 的改动', d.entries.some((e) => e.name === 'D' && e.op === 'changed'),
    d.summary);

  // ── 7. 受管工作目录 ───────────────────────────────────────────
  const cfile = path.join(WORKDIR, 'construction.ggb.txt');
  check('写出 construction.ggb.txt', fs.existsSync(cfile),
    fs.existsSync(cfile) ? `${fs.statSync(cfile).size} bytes` : '');

  // ── 8. case-01「假成功」必须被体检抓出 ────────────────────────
  const broken = buildBoardState({
    commands: DEMO_COMMANDS,
    names: ['A', 'B', 'f', 'g', 'D'],
    objects: {
      A: { type: 'point', value: '(0, 0)', independent: true },
      B: { type: 'point', value: '(3, 2)', independent: true },
      f: { type: 'line', value: 'y = x', independent: false },
      g: { type: 'function', value: 'g(x)', independent: false },
      D: { type: 'point', value: '(?, ?)', independent: false },
    },
    sliders: [], png: null, pngSource: 'none', generation: 2,
  }, { ...DEFAULT_TOOLS_CONFIG, workdir: WORKDIR });
  check('case-01「假成功」被抓住', broken.audit.undefinedObjs.some((f) => f.name === 'D'),
    JSON.stringify(broken.audit.undefinedObjs));

  await browser.close();
  await bridge.stop();

  const failed = results.filter((r) => !r.ok);
  console.log('\n──────────────────────────────────────');
  console.log(`${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length) {
    console.log('未通过:');
    for (const f of failed) console.log('  -', f.name, f.detail);
    process.exit(1);
  }
  console.log('端到端验收通过：agent 现在能「看见」并「改动」画布了。');
  process.exit(0);
}

main().catch((e) => {
  console.error('E2E 失败:', e.stack || e);
  process.exit(1);
});
