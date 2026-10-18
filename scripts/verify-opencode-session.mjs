/**
 * 内置 Agent（OpenCode）多轮会话验证 —— **`-s <sessionId>` 真的把上下文接上了**。
 *
 * 三轮，第三轮是**反向对照**：
 *   A 首次：让它记住一个数字 → 从事件流里捕获 sessionID
 *   B 续接：带 -s 重问那个数字 → 必须答得出（否则就是没接上）
 *   C 对照：不带 -s 重问       → **必须答不出**，否则「B 答对了」可能来自别处
 *     （比如我们误开了转写注入——那个会让每次都被喂一遍历史，看着也像接上了，
 *      但那正是我们要避免的双份上下文）
 *
 * 用法同 verify-opencode-builtin.mjs（OPENCODE_BIN 或装进 node_modules）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const { opencode, runAgent, resolveRuntimeTarget, buildOpenCodeConfigContent } =
  await import(`file:///${REPO.replace(/\\/g, '/')}/packages/agent-runtime/src/index.ts`);

if (!resolveRuntimeTarget(opencode)) {
  console.error('✗ 解不出 opencode 的可执行文件（设 OPENCODE_BIN）');
  process.exit(2);
}

const DAEMON_URL = process.env.MATHMOVER_DAEMON_URL ?? 'http://127.0.0.1:8788';
const MODEL = process.env.MM_VERIFY_MODEL ?? 'opencode/deepseek-v4.1-flash-free';
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-oc-session-'));

const config = buildOpenCodeConfigContent({
  provider: null,
  mcp: {
    command: process.execPath,
    args: [path.join(REPO, 'packages', 'daemon', 'src', 'mcp-stdio.ts')],
    env: { MATHMOVER_DAEMON_URL: DAEMON_URL },
  },
});

/** 跑一轮，返回 { text, sessionId, args }。 */
async function turn(prompt, resumeSessionId) {
  let sessionId = resumeSessionId;
  let text = '';
  const errors = [];
  let args = [];
  const handle = runAgent({
    def: opencode,
    prompt,
    mcpConfigPath: path.join(REPO, 'packages', 'daemon', 'mcp', 'runtime-mcp.json'),
    cwd: SANDBOX,
    resumeSessionId,
    extraArgs: ['--model', MODEL],
    env: { OPENCODE_CONFIG_CONTENT: config },
    inactivityTimeoutMs: 120_000,
    firstOutputTimeoutMs: 120_000,
    onEvent: (e) => {
      if (e.kind === 'session') sessionId = e.sessionId;
      if (e.kind === 'text' || e.kind === 'text-delta') text += e.text;
      if (e.kind === 'error') errors.push(e.message);
    },
  });
  args = handle.proc?.spawnargs ?? [];
  await handle.done;
  return { text: text.trim(), sessionId, errors, args };
}

const SECRET = '7391';
console.log(`沙箱：${SANDBOX}\n模型：${MODEL}\n`);

console.log(`[A] 首次（让它记住 ${SECRET}）…`);
const a = await turn(`请记住这个数字：${SECRET}。稍后我会问你。现在只回复「好的」两个字。`);
console.log(`    → sessionId=${a.sessionId}\n    → 正文「${a.text.slice(0, 60)}」`);
const hasSession = /^ses_/.test(a.sessionId ?? '');
const aArgs = a.args.join(' ');
const aHasS = /(^|\s)-s(\s|=)/.test(aArgs);
console.log(`    → argv 里${aHasS ? '有' : '没有'} -s（首轮不该有）\n`);

console.log('[B] 续接（带 -s 重问）…');
const b = await turn('我刚才让你记住的数字是多少？只回答那个数字。', a.sessionId);
const bArgs = b.args.join(' ');
const bHasS = bArgs.includes(`-s ${a.sessionId}`);
console.log(`    → sessionId=${b.sessionId}（应与 A 相同）\n    → 正文「${b.text.slice(0, 80)}」\n`);

console.log('[C] 反向对照（不带 -s）…');
const c = await turn('我刚才让你记住的数字是多少？只回答那个数字。');
console.log(`    → sessionId=${c.sessionId}（新会话）\n    → 正文「${c.text.slice(0, 80)}」\n`);

const checks = [
  ['A 捕获到会话 id', hasSession],
  ['A 首轮不带 -s', !aHasS],
  [`B 的 argv 带了 -s <A 的会话 id>`, bHasS],
  ['B 续的是同一个会话（id 不变）', b.sessionId === a.sessionId],
  [`B 答出了 ${SECRET}（上下文真的接上了）`, b.text.includes(SECRET)],
  [`C 答不出 ${SECRET}（证明 B 的上下文来自会话而不是别处注入）`, !c.text.includes(SECRET)],
  ['三轮都没有 error 事件', !a.errors.length && !b.errors.length && !c.errors.length],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failed++; }
try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* 清理失败不致命 */ }
process.exit(failed ? 1 : 0);
