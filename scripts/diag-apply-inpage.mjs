/**
 * 最小诊断：只回答一个问题 —— 页面内 `window.__mmGgb.apply()` 会不会挂？
 *
 * 不碰 daemon、不碰网络：桥的 apply 在页面里直接执行，超时即说明
 * `useGgbSession.executeCommands` 的 Promise 没有落定。
 *
 * 运行：node scripts/diag-apply-inpage.mjs
 */

import { chromium } from 'playwright';

const b = await chromium.launch({
  channel: 'chrome', headless: true,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-features=LocalNetworkAccessChecks', '--allow-insecure-localhost',
  ],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 250)));
p.on('console', (m) => {
  const t = m.text();
  if (/\[mm\]|apply|error/i.test(t)) console.log('  [page]', t.slice(0, 200));
});

await p.goto('http://localhost:3000/dashboard', {
  waitUntil: 'domcontentloaded', timeout: 60000,
});

// 等桥真正就绪
let ok = false;
for (let i = 0; i < 45; i++) {
  await p.waitForTimeout(1000);
  ok = await p.evaluate(() => !!window.__mmGgb);
  if (ok) { console.log(`  ✓ 第 ${i + 1}s 桥就绪`); break; }
}
if (!ok) { console.log('  ✗ 桥未就绪'); await b.close(); process.exit(1); }

for (const [label, commands, ms] of [
  ['A 最小(3条)', ['A = (0, 0)', 'B = (3, 2)', 'f = Line(A, B)'], 10000],
  ['B 带属性(5条)', ['A = (0, 0)', 'B = (3, 2)', 'f = Line(A, B)', 'g = Function(x^2/4, -3, 3)', 'SetColor(f, "#FF0000")'], 12000],
]) {
  const t0 = Date.now();
  const r = await p.evaluate(async ({ cmds, timeoutMs }) => {
    const timeout = new Promise((res) => setTimeout(() => res({ __timeout: true }), timeoutMs));
    return Promise.race([window.__mmGgb.apply(cmds), timeout]);
  }, { cmds: commands, timeoutMs: ms });
  const dt = Date.now() - t0;
  const summary = r?.__timeout
    ? '⚠ 超时（executeCommands 未落定）'
    : `applied=${r?.applied?.length} failed=${r?.failedFirstPass?.length} 对象=${r?.state?.names?.length}`;
  console.log(`  ${label}: ${dt}ms  ${summary}`);
}

await b.close();
