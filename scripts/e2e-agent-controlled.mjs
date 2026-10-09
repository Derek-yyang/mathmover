/**
 * 受控端到端：干净浏览器 + 真实 Claude Code 驱动真实画布。
 *
 * 全程单一页面连接 daemon，排除用户浏览器实时状态的干扰。
 *
 * 场景（产品核心）：
 *   ① 让 agent 建一个「抛物线与直线相交」模型
 *   ② 验证画布真的有对象、PNG 真的画出来了
 *   ③ 多轮微调：「把动点 B 沿红线上移」
 *   ④ 验证改动生效，并看 agent 有没有说清改了什么
 *
 * 前置：daemon 已在 8787/8788 运行，Next dev 在 3000。
 * 运行：node scripts/e2e-agent-controlled.mjs
 */

import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const DAEMON = 'http://127.0.0.1:8788';
const MCP_CONFIG = 'spike-out/mcp/claude-mcp.json';
const OUT = 'spike-out/e2e';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
}

function runClaude(prompt, extraArgs = []) {
  const args = [
    '-p', prompt,
    '--mcp-config', MCP_CONFIG,
    '--restricted',
    '--output-format', 'json',
    // 不要加 --verbose：那是 stream-json 才需要的，
    // 在 --output-format json 下它会把输出污染成多行事件流。
    ...extraArgs,
  ];
  // 参数走 execSync 的数组形式无法用于 claude（Windows 需 shell），故显式加引号保护 prompt
  const quoted = args.map((a) => (a.startsWith('-') || a === MCP_CONFIG ? a : `"${a.replace(/"/g, '\\"')}"`));
  const out = execSync(`claude ${quoted.join(' ')}`, {
    encoding: 'utf-8',
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  // 输出应是单个 result JSON；但保险起见按行扫 type==="result"。
  fs.writeFileSync('spike-out/e2e/last-claude-raw.txt', out);
  const lines = out.trim().split('\n').filter(Boolean);
  let parsed = null;
  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      if (o && o.type === 'result') { parsed = o; break; }
    } catch { /* 非 JSON 行，跳过 */ }
  }
  if (!parsed) {
    // 兜底：整体可能就是一个 JSON 对象
    try { parsed = JSON.parse(out.trim()); } catch {
      parsed = { result: out.trim(), session_id: null, __parseFailed: true };
    }
  }
  return parsed;
}

async function getState(png = true) {
  return fetch(`${DAEMON}/api/state?png=${png ? 1 : 0}`).then((r) => r.json());
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // ── 1. 干净浏览器，唯一连接 ─────────────────────────────────
  const b = await chromium.launch({
    channel: 'chrome', headless: true,
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-features=LocalNetworkAccessChecks', '--allow-insecure-localhost',
    ],
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });

  let bridge = false;
  for (let i = 0; i < 45; i++) {
    await p.waitForTimeout(1000);
    bridge = await p.evaluate(() => !!window.__mmGgb);
    if (bridge) break;
  }
  check('干净画布桥就绪', bridge);
  if (!bridge) { await b.close(); return finish(); }

  // 基线：应为空
  const before = await getState(false);
  check('起始画布为空', (before.commands?.length ?? 0) === 0,
    `commands=${before.commands?.length}, generation=${before.generation}`);

  // ── 2. 第一轮：建模 ─────────────────────────────────────────
  console.log('\n── 第一轮：让 agent 建模 ──');
  const t0 = Date.now();
  const r1 = runClaude(
    '请调用 ggb_apply 建一个抛物线与直线相交的几何模型：' +
    '抛物线 g = Function(x^2/4, -3, 3)，直线 f 过 A(0,0) 与 B(3,2)，把 f 标红。' +
    '建好后用一两句话说明你建了什么。',
  );
  console.log(`  耗时 ${Math.round((Date.now() - t0) / 1000)}s | session=${r1.session_id}`);
  console.log('  agent 说：', String(r1.result ?? '').slice(0, 300).replace(/\n/g, ' '));

  const s1 = await getState(true);
  check('建模后画布有对象', (s1.objects?.length ?? 0) >= 3,
    (s1.objects ?? []).map((o) => o.name).join(',') || '(空)');
  check('账本记录了指令', (s1.commands?.length ?? 0) >= 4, `${s1.commands?.length} 行`);
  check('体检无未定义对象', (s1.audit?.findings?.length ?? 0) === 0,
    JSON.stringify(s1.audit?.findings ?? []));

  const pngLen = s1.png?.base64?.length ?? 0;
  check('PNG 非空且来自 canvas', pngLen > 500, `${pngLen} chars, source=${s1.png?.source}`);
  if (pngLen > 500) {
    fs.writeFileSync(`${OUT}/round1-canvas.png`, Buffer.from(s1.png.base64, 'base64'));
    const buf = fs.readFileSync(`${OUT}/round1-canvas.png`);
    console.log(`  PNG ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}, ${buf.length} bytes → ${OUT}/round1-canvas.png`);
  }

  const sessionId = r1.session_id;

  // ── 3. 第二轮：多轮微调（同一 session） ─────────────────────
  console.log('\n── 第二轮：多轮微调「把 B 上移」──');
  if (!sessionId) {
    check('拿到 session id 以续接多轮', false, '无 session id，跳过微调轮');
  } else {
    const t1 = Date.now();
    const r2 = runClaude(
      '很好。现在把点 B 往上移 2 个单位（改成 B=(3,4)），其余保持不变。' +
      '用一句话告诉我你改了什么。',
      ['--resume', sessionId],
    );
    console.log(`  耗时 ${Math.round((Date.now() - t1) / 1000)}s`);
    console.log('  agent 说：', String(r2.result ?? '').slice(0, 300).replace(/\n/g, ' '));

    const s2 = await getState(true);
    const bObj = (s2.objects ?? []).find((o) => o.name === 'B');
    check('微调后 B 真的变了', /3/.test(String(bObj?.value ?? '')) && /4/.test(String(bObj?.value ?? '')),
      `B = ${bObj?.value ?? '(不存在)'}`);
    check('其余对象保留', (s2.objects?.length ?? 0) >= (s1.objects?.length ?? 0),
      (s2.objects ?? []).map((o) => o.name).join(','));
    if (s2.png?.base64) fs.writeFileSync(`${OUT}/round2-canvas.png`, Buffer.from(s2.png.base64, 'base64'));

    // agent 是否说清了改动
    const said = String(r2.result ?? '');
    check('agent 用自然语言说清改动', said.length > 20 && /改|移|变|调整|B/.test(said), said.slice(0, 120));
  }

  await p.screenshot({ path: `${OUT}/controlled-final.png` });
  console.log(`\n  截图 → ${OUT}/controlled-final.png`);

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
