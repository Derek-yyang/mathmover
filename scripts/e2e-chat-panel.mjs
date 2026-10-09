/**
 * 对话框真流浏览器验收：真实 UI → /api/agent → agent CLI → MCP → daemon → 画布。
 *
 * 与 e2e-agent-controlled 的区别：不 execSync 直调 claude，全程走用户可见的产品路径
 * （面板输入框 → NDJSON 流 → 气泡渲染），覆盖流式渲染与运行时选择器的接线。
 *
 * 前置：daemon 在 8787/8788；Next dev 在 3000（且其进程环境里 claude 可认证）。
 * 跑法：node scripts/e2e-chat-panel.mjs [claude-code|codex|dsh]
 *      传了 runtimeId 就在选择器里切过去再发（验证选择器接线）。
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DAEMON = 'http://127.0.0.1:8788';
// 绝对路径：脚本可能从任意 cwd 跑，别再让截图散到两个 spike-out
const OUT = fileURLToPath(new URL('../spike-out/e2e/', import.meta.url));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
}

const getState = (png = false) => fetch(`${DAEMON}/api/state?png=${png ? 1 : 0}`).then((r) => r.json());

/**
 * 在面板里发一句话，等这一轮真正收尾。
 *
 * 判据（都取自产品自身状态，防各种误判）：
 * ① POST /api/agent 计数 +1 = 这一轮真的发出去了（isLoading 守卫会静默吞掉重复发送）
 * ② 发送按钮图标回到 Send（.lucide-send）= isLoading 翻 false = 流已完全消费
 */
async function sendAndWait(page, text, stats, timeoutMs = 240_000) {
  const ta = page.locator('textarea[placeholder*="输入题目描述"]');
  // 等上一轮 idle（Send 图标在 = 没在加载）
  await page.locator('button:has(.lucide-send)').first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
  await ta.click();
  await ta.fill(text);
  const postsBefore = stats.posts;
  await ta.press('Enter');
  const t0 = Date.now();

  // ① 请求真的发出去了吗（5s 内没发 = 被 isLoading 吞了，等 idle 后重试一次）
  while (stats.posts === postsBefore && Date.now() - t0 < 5000) await page.waitForTimeout(200);
  if (stats.posts === postsBefore) {
    console.log('  [!] 发送未触发请求，等 idle 后重试一次');
    await page.locator('button:has(.lucide-send)').first().waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {});
    await ta.fill(text);
    await ta.press('Enter');
    while (stats.posts === postsBefore && Date.now() - t0 < 15_000) await page.waitForTimeout(200);
  }

  // ② 等这一轮的流收完（Send 图标回来）
  await page.locator('button:has(.lucide-send)').first().waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(1200); // 让最后几条事件渲染进气泡
  return Date.now() - t0;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const b = await chromium.launch({
    channel: 'chrome', headless: true,
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-features=LocalNetworkAccessChecks', '--allow-insecure-localhost',
    ],
  });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const stats = { posts: 0 };
  p.on('request', (r) => {
    if (r.url().includes('/api/agent') && r.method() === 'POST') stats.posts += 1;
  });
  await p.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });

  let bridge = false;
  for (let i = 0; i < 45; i++) {
    await p.waitForTimeout(1000);
    bridge = await p.evaluate(() => !!window.__mmGgb);
    if (bridge) break;
  }
  check('画布桥就绪', bridge);
  if (!bridge) { await b.close(); return finish(); }

  // 清账本，排除此前失败轮次的残留（否则 doneWhen 可能被旧对象瞬间满足）
  await fetch(`${DAEMON}/api/reset`, { method: 'POST' }).catch(() => {});
  await p.waitForTimeout(1500);
  const baseline = await getState(false);
  check('起始画布为空', (baseline.objects?.length ?? 0) === 0,
    `objects=${baseline.objects?.length ?? 0}, commands=${baseline.commands?.length ?? 0}`);

  // 指定了 runtimeId 就在选择器里切过去（验证选择器 → 路由的接线）
  const runtimeId = process.argv[2];
  if (runtimeId) {
    await p.locator('select').first().selectOption(runtimeId);
    await p.waitForTimeout(500);
    const picked = await p.locator('select').first().inputValue();
    check(`选择器切到 ${runtimeId}`, picked === runtimeId, `当前=${picked}`);
  }

  // ── 第一轮：首发送题 ─────────────────────────────────────
  console.log('\n── 第一轮：发送题目建模 ──');
  const before1 = await p.locator('body').innerText();
  const ms1 = await sendAndWait(p,
    '请调用 ggb_apply 建一个抛物线与直线相交的几何模型：' +
    '抛物线 g = Function(x^2/4, -3, 3)，直线 f 过 A(0,0) 与 B(3,2)，把 f 标红。建好后一两句说明。', stats);
  console.log(`  耗时 ${Math.round(ms1 / 1000)}s`);

  const panelText1 = await p.locator('body').innerText();
  // 文本断言用全文检索：消息区的时间戳会跳字，前缀差分会被随机截断
  check('气泡有自然语言回复', panelText1.includes('MathMover Agent') && /抛物线/.test(panelText1),
    panelText1.match(/MathMover Agent[\s\S]{0,60}/)?.[0].replace(/\n/g, ' ') ?? '');
  if (runtimeId !== 'dsh') {
    // 工具调用的 UI 呈现：旧版气泡内〔调用 …〕，新版收进「执行过程」折叠区
    check('流中出现工具调用提示', panelText1.includes('〔调用') || panelText1.includes('执行过程'),
      panelText1.includes('执行过程') ? '(执行过程折叠区)' : '(〔调用 …〕)');
  }
  check('无错误标记 ⚠', !panelText1.includes('⚠'), panelText1.match(/⚠[^\n]*/)?.[0] ?? '');

  const s1 = await getState(true);
  check('画布真建出对象', (s1.objects?.length ?? 0) >= 3,
    (s1.objects ?? []).map((o) => o.name).join(','));
  check('账本有指令', (s1.commands?.length ?? 0) >= 4, `${s1.commands?.length} 行`);
  check('体检干净', (s1.audit?.findings?.length ?? 0) === 0);
  if ((s1.png?.base64?.length ?? 0) > 500) {
    fs.writeFileSync(`${OUT}/chat-panel-round1.png`, Buffer.from(s1.png.base64, 'base64'));
  }

  // ── 第二轮：UI 多轮微调（同一 sessionId 续接） ─────────────
  console.log('\n── 第二轮：对话微调「把 B 上移」 ──');
  const ms2 = await sendAndWait(p, '把点 B 上移到 (3,4)，其他保持不变。', stats);
  console.log(`  耗时 ${Math.round(ms2 / 1000)}s`);

  const s2 = await getState(true);
  const bObj = (s2.objects ?? []).find((o) => o.name === 'B');
  check('B 真的移动到 (3,4)', /\(3,\s*4\)/.test(JSON.stringify(bObj ?? {})),
    JSON.stringify(bObj ?? {}).slice(0, 60));
  check('其余对象保留', (s2.objects ?? []).length >= 3,
    (s2.objects ?? []).map((o) => o.name).join(','));

  const panelText2 = await p.locator('body').innerText();
  check('第二轮有说明', /3[,，]\s*4/.test(panelText2), panelText2.match(/[^\n]{0,60}3[,，]\s*4[^\n]{0,40}/)?.[0] ?? '(未见 (3,4) 相关说明)');
  await p.screenshot({ path: `${OUT}/chat-panel-final.png`, fullPage: false });

  await b.close();
  finish();
}

function finish() {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n──────────────────────────────`);
  console.log(`${pass}/${results.length} 项通过`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
