/**
 * 验证：真实浏览器打开 /agent 工作台 → 画布桥连上 daemon → 能写入、能读回含 PNG 的状态。
 * 不需要 LLM key —— 验的是「画布 ↔ daemon ↔ agent 路由」链路与取图通道。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const DEMO = ['A = (0, 0)', 'B = (3, 2)', 'f = Line(A, B)', 'g = Function(x^2 / 4, -3, 3)', 'SetColor(f, "#FF0000")'];

const b = await chromium.launch({ channel: 'chrome', headless: true, args: [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-features=LocalNetworkAccessChecks', '--allow-insecure-localhost',
]});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));

console.log('打开 http://localhost:3000/dashboard …');
await p.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });

let ok = false;
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(1000);
  const r = await fetch('http://127.0.0.1:8788/api/health').then((x) => x.json()).catch(() => null);
  if (r?.canvasConnected) { ok = true; console.log(`  ✓ 第 ${i + 1}s 画布已连上 daemon`); break; }
}
if (!ok) { console.log('  ✗ 画布未连上 daemon'); await b.close(); process.exit(1); }

const applied = await fetch('http://127.0.0.1:8788/api/apply', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ commands: DEMO }),
}).then((x) => x.json());
console.log('  ✓ 写入构造：', applied.diff?.summary ?? JSON.stringify(applied).slice(0, 120));

const s = await fetch('http://127.0.0.1:8788/api/state?png=1').then((x) => x.json());
const pngLen = s.png?.base64?.length ?? 0;
console.log(`  读回状态: 指令=${s.commands?.length} 对象=${s.objects?.length} 滑块=${s.sliders?.length} PNG=${pngLen} chars (${s.png?.source ?? 'none'})`);

if (pngLen > 500) {
  fs.mkdirSync('spike-out/e2e', { recursive: true });
  const buf = Buffer.from(s.png.base64, 'base64');
  fs.writeFileSync('spike-out/e2e/dashboard-canvas.png', buf);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  console.log(`  ✓ PNG 有效 ${w}x${h}, ${buf.length} bytes → spike-out/e2e/dashboard-canvas.png`);
} else {
  console.log('  ✗ PNG 取图失败（agent 将无法「看见」画布）');
}

const health = await fetch('http://localhost:3000/api/agent').then((x) => x.json());
console.log('  agent 路由健康检查:', JSON.stringify(health));

await p.screenshot({ path: 'spike-out/e2e/dashboard-workbench.png' });
console.log('  截图 → spike-out/e2e/dashboard-workbench.png');

await b.close();
process.exit(pngLen > 500 && health.canvasConnected ? 0 : 1);
