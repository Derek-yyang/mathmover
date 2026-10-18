/**
 * 内置 Agent（OpenCode）通路的真机验证：**跑我们自己的 runAgent + opencode 定义**，
 * 经我们组装出来的 OPENCODE_CONFIG_CONTENT 把 MCP 挂上，打真实的 daemon。
 *
 * 为什么不跑真模型端点：本机没有一个可用的 BYOK 端点（cc-switch 代理的 Codex 通道
 * 要 ChatGPT 登录）。所以模型这一格借 opencode 自带的免费档（用 `--model` 长旗标
 * 走 extraArgs，绕开我们定义里的 provider 前缀），**其余全是产品路径**：
 *   - 我们 spawn 的 argv（--dir / --dangerously-skip-permissions / 附件位）
 *   - 我们组装的 config content（mcp + permission.bash=deny）
 *   - 真的 mcp-stdio.ts → daemon
 *   - 我们的 parseLine 对着真流解析
 * provider 那一块由单测与另一支探针覆盖（形状对齐 OpenDesign 生产代码）。
 *
 * 用法（Windows）：先设 OPENCODE_BIN 指向平台包的二进制，或把它装进 node_modules
 *   OPENCODE_BIN=... node scripts/verify-opencode-builtin.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const REPO = path.resolve(import.meta.dirname, '..');
const { opencode, runAgent, resolveRuntimeTarget, buildOpenCodeConfigContent } =
  await import(`file:///${REPO.replace(/\\/g, '/')}/packages/agent-runtime/src/index.ts`);

const target = resolveRuntimeTarget(opencode);
if (!target) {
  console.error('✗ 解不出 opencode 的可执行文件：设 OPENCODE_BIN，或把平台包装进 node_modules');
  process.exit(2);
}
console.log(`解析到：${target.command}${target.prefixArgs.length ? ' ' + target.prefixArgs.join(' ') : ''}`);

const DAEMON_URL = process.env.MATHMOVER_DAEMON_URL ?? 'http://127.0.0.1:8788';
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-oc-verify-'));

// 与 route.ts 同一条组装路径（provider 这一格留空，见文件头）
const config = buildOpenCodeConfigContent({
  provider: null,
  mcp: {
    command: process.execPath,
    args: [path.join(REPO, 'packages', 'daemon', 'src', 'mcp-stdio.ts')],
    env: { MATHMOVER_DAEMON_URL: DAEMON_URL },
  },
});
if (!config) { console.error('✗ 配置组装返回 null'); process.exit(2); }
const parsed = JSON.parse(config);
console.log(`配置：mcp=${Object.keys(parsed.mcp ?? {}).join(',')} permission=${JSON.stringify(parsed.permission)}`);
if (parsed.mcp?.mathmover?.type !== 'local') { console.error('✗ mcp 项形状不对'); process.exit(2); }
if (parsed.permission?.bash !== 'deny') { console.error('✗ permission.bash 不是 deny'); process.exit(2); }

const events = [];
const t0 = performance.now();
const marks = { firstRaw: null, firstSubstantive: null };
let sessionId;

const handle = runAgent({
  def: opencode,
  prompt: '用 ggb_apply 工具下发这两条指令：A=(0,0)、B=(2,0)。然后一句话确认你做了什么。',
  mcpConfigPath: path.join(REPO, 'packages', 'daemon', 'mcp', 'runtime-mcp.json'),
  cwd: sandbox,
  // 借 opencode 自带模型（见文件头），长旗标且不经过我们的 -m 前缀
  extraArgs: ['--model', process.env.MM_VERIFY_MODEL ?? 'opencode/deepseek-v4.1-flash-free'],
  images: [],
  env: { OPENCODE_CONFIG_CONTENT: config },
  inactivityTimeoutMs: 120_000,
  firstOutputTimeoutMs: 120_000,
  onEvent: (e) => {
    const now = performance.now();
    if (e.kind === 'raw') marks.firstRaw ??= now;
    if (['text', 'text-delta', 'thinking', 'tool-call'].includes(e.kind)) marks.firstSubstantive ??= now;
    if (e.kind === 'session') sessionId = e.sessionId;
    events.push(e);
    if (e.kind === 'raw') return;
    if (e.kind === 'text-delta') return console.log(`  text-delta: ${JSON.stringify(e.text.slice(0, 70))}`);
    if (e.kind === 'tool-call') return console.log(`  tool-call : ${e.name}  ${JSON.stringify(e.input)?.slice(0, 90)}`);
    if (e.kind === 'tool-result') return console.log(`  tool-result: isError=${e.isError} ${JSON.stringify(e.output)?.slice(0, 120)}`);
    console.log(`  ${e.kind}${e.sessionId ? ' ' + e.sessionId : ''}${e.message ? ': ' + e.message.slice(0, 140) : ''}`);
  },
});

const { exitCode } = await handle.done;

// ---- 断言 ----
const kinds = events.map((e) => e.kind);
const toolCalls = events.filter((e) => e.kind === 'tool-call');
const toolResults = events.filter((e) => e.kind === 'tool-result');
const texts = events.filter((e) => e.kind === 'text' || e.kind === 'text-delta');

const checks = [
  ['捕获到会话 id', /^ses_/.test(sessionId ?? '')],
  ['工具名已剥成 ggb_apply（不是 mathmover_ggb_apply）', toolCalls.some((e) => e.name === 'ggb_apply')],
  ['工具调用带 callID（前端按它去重）', toolCalls.every((e) => e.toolCallId)],
  ['工具结果成对回来', toolResults.length >= 1 && toolResults.length === toolCalls.length],
  ['有正文下发', texts.length >= 1],
  ['退出码为 0', exitCode === 0],
  ['没有 error 事件', !kinds.includes('error')],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failed++; }

console.log(`\n耗时：我方开销 ${Math.round((marks.firstRaw ?? 0) - t0)}ms / 首实质输出 `
  + `${marks.firstSubstantive ? Math.round(marks.firstSubstantive - t0) : '—'}ms / 全程 ${Math.round(performance.now() - t0)}ms`);
console.log(`事件序列：${kinds.filter((k) => k !== 'raw').join(' → ')}`);
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* 清理失败不致命 */ }
process.exit(failed ? 1 : 0);
