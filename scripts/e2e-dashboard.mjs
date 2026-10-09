/**
 * dashboard 端到端验收。
 *
 * 前置：daemon 已在 8787/8788 运行，Next dev 在 3000 运行。
 *   node packages/daemon/src/cli.ts --no-mcp --ws-port 8787 --http-port 8788
 *   cd math-mover-next && npm run dev
 *
 * 关键：桥是否就绪**只看 `window.__mmGgb`**，不看 /api/health。
 * 经验教训：僵尸 WebSocket 连接会让 health 提前返回 canvasConnected=true，
 * 而此时新页面的桥还没挂上，导致 apply 调用超时（桥要 ~30s 才就绪，
 * 因为 GeoGebra 走 CDN 加载）。
 *
 * 运行：node scripts/e2e-dashboard.mjs
 */

import { chromium } from 'playwright';

const DAEMON = 'http://127.0.0.1:8788';
const DEMO = [
  'A = (0, 0)', 'B = (3, 2)', 'f = Line(A, B)',
  'g = Function(x^2 / 4, -3, 3)', 'SetColor(f, "#FF0000")', 'SetLineThickness(g, 5)',
];

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  const b = await chromium.launch({
    channel: 'chrome', headless: true,
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-features=LocalNetworkAccessChecks', '--allow-insecure-localhost',
    ],
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));

  await p.goto('http://localhost:3000/dashboard', {
    waitUntil: 'domcontentloaded', timeout: 60000,
  });

  // ── 桥就绪（唯一可信信号） ────────────────────────────────────
  let ready = false;
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    await p.waitForTimeout(1000);
    ready = await p.evaluate(() => !!window.__mmGgb);
    if (ready) break;
  }
  check('画布桥已挂载到 dashboard', ready, `${Math.round((Date.now() - t0) / 1000)}s`);
  if (!ready) { await b.close(); return finish(); }

  // ── 写入构造 ─────────────────────────────────────────────────
  const t1 = Date.now();
  const applied = await fetch(`${DAEMON}/api/apply`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commands: DEMO }),
  }).then((r) => r.json()).catch((e) => ({ error: String(e) }));

  check('ggb_apply 经 daemon→WS→页面 执行成功', !applied.error,
    applied.error ? applied.error : `${Date.now() - t1}ms, ${applied.applied?.length ?? 0} 条`);
  check('apply 返回改动说明', typeof applied.diff?.summary === 'string', applied.diff?.summary ?? '');

  // ── 读回状态（含 PNG） ───────────────────────────────────────
  const s = await fetch(`${DAEMON}/api/state?png=1`).then((r) => r.json());
  check('ggb_get_state 返回 commands[]', (s.commands?.length ?? 0) >= 5, `${s.commands?.length} 行`);
  check('ggb_get_state 返回 objects[]', (s.objects?.length ?? 0) >= 4,
    (s.objects ?? []).map((o) => o.name).join(','));
  const pngLen = s.png?.base64?.length ?? 0;
  check('ggb_get_state 返回画布 PNG', pngLen > 500,
    `${pngLen} chars, source=${s.png?.source ?? 'none'}`);

  if (pngLen > 500) {
    const buf = Buffer.from(s.png.base64, 'base64');
    const { default: fs } = await import('node:fs');
    fs.mkdirSync('spike-out/e2e', { recursive: true });
    fs.writeFileSync('spike-out/e2e/dashboard-canvas.png', buf);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    check('PNG 是有效图片', buf.slice(1, 4).toString() === 'PNG', `${w}x${h}, ${buf.length} bytes`);
  }

  // ── 颜色真的生效（假失败陷阱的回归验证） ────────────────────
  const color = await p.evaluate(() => {
    const api = window.ggbApplet;
    if (!api?.getColor) return null;
    const n = api.getColor('f');
    return typeof n === 'number' ? '#' + n.toString(16).padStart(6, '0').toUpperCase() : String(n);
  });
  check('SetColor 真的生效（假失败已修）', color === '#FF0000', `f 颜色 = ${color}`);

  // ── agent 路由 ──────────────────────────────────────────────
  const health = await fetch('http://localhost:3000/api/agent').then((r) => r.json());
  check('agent 路由能感知画布', health.canvasConnected === true, JSON.stringify(health));

  await p.screenshot({ path: 'spike-out/e2e/dashboard-final.png' });
  console.log('  截图 → spike-out/e2e/dashboard-final.png');

  await b.close();
  return finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log('\n──────────────────────────────────────');
  console.log(`${results.length - failed.length}/${results.length} 项通过`);
  if (failed.length) {
    console.log('未通过:');
    for (const f of failed) console.log('  -', f.name, f.detail);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('失败:', e.stack || e);
  process.exit(1);
});
