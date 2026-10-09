/**
 * /api/agent POST 路由冒烟——直接调 route 的 POST()（跳过 Next 的 HTTP 管道），
 * 但 spawn / MCP / 流解析 / NDJSON 编码全是真实产品路径。
 *
 * 跑法（在 math-mover-next 下）：
 *   node --experimental-strip-types scripts/smoke-agent-route.mjs [claude-code|codex|dsh]
 * 有会话能力的 runtime（claude/codex）会自动加一轮续接验证；dsh 是 one-shot 跳过。
 */

import { POST } from '../app/api/agent/route.ts';
import fs from 'node:fs';

const runtimeId = process.argv[2] ?? 'claude-code';
const HAS_SESSION = runtimeId !== 'dsh'; // dsh headless 无会话（README 明示 one-shot）
const EXPECT_TOOL_EVENTS = runtimeId !== 'dsh'; // dsh 只吐最终纯文本，无工具事件

// 验收素材：真题图（椭圆动点三角形面积题）
const caseImage = (() => {
  const p = new URL('../public/cases/case1.png', import.meta.url);
  return { mediaType: 'image/png', base64: fs.readFileSync(p).toString('base64'), name: 'case1.png' };
})();

const history = [];

async function send(text, sessionId, images) {
  const res = await POST(
    new Request('http://local/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, runtimeId, sessionId, history: [...history], images }),
    }),
  );
  const events = [];
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        events.push(JSON.parse(l));
      } catch {
        console.log('非 JSON 行:', l.slice(0, 100));
      }
    }
  }
  // 记入历史（dsh 的转写注入靠它；claude/codex 有自己的会话，路由只会忽略）
  history.push({ role: 'user', content: text });
  const said = events.filter((e) => e.kind === 'text').map((e) => e.text ?? '').join('');
  if (said) history.push({ role: 'assistant', content: said });
  return events;
}

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};

// ── 第一轮：带工具的建模型请求 ─────────────────────────────
console.log(`\n── [${runtimeId}] 第一轮：调工具看画布 ──`);
const prompt1 = HAS_SESSION
  ? '调用 ggb_get_state 看一眼画布，然后一句话说你看到了什么'
  : '调用 ggb_get_state 看一眼画布，然后一句话说你看到了什么。另外请记住这个暗号：青橙紫。';
const ev1 = await send(prompt1);
const kinds = {};
for (const e of ev1) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
console.log('kinds:', JSON.stringify(kinds));

const session = ev1.find((e) => e.kind === 'session');
const calls = ev1.filter((e) => e.kind === 'tool-call');
const results = ev1.filter((e) => e.kind === 'tool-result');
const texts = ev1.filter((e) => e.kind === 'text').map((e) => e.text ?? '');
const deltas = ev1.filter((e) => e.kind === 'text-delta').map((e) => e.text ?? '');
const errors = ev1.filter((e) => e.kind === 'error');
const done = ev1.find((e) => e.kind === 'done');

if (HAS_SESSION) {
  check('带出 session', Boolean(session?.sessionId), session?.sessionId ?? '');
} else {
  check('one-shot（无 session 事件，符合 dsh 语义）', !session);
}
if (EXPECT_TOOL_EVENTS) {
  check('有 tool-call 且名字已剥前缀', calls.length > 0 && calls.every((c) => !c.name.startsWith('mcp__')),
    calls.map((c) => c.name).join(','));
  check('tool-call/tool-result 成对', calls.length > 0 && calls.length === results.length, `${calls.length}/${results.length}`);
} else {
  check('无工具事件（one-shot 纯文本）', calls.length === 0 && results.length === 0);
}
check('有自然语言', texts.join('').length > 0, texts.join('').slice(0, 60).replace(/\n/g, ' '));
if (deltas.length > 0) {
  check('增量与完整文本一致', deltas.join('') === texts.join(''), `delta=${deltas.join('').length} full=${texts.join('').length}`);
}
check('done 收尾', Boolean(done), done?.sessionId ?? '');
check('无 error 事件', errors.length === 0, errors.map((e) => e.message).join(' | ').slice(0, 120));

// ── 第二轮：续接（会话型）或转写注入记忆（无会话型）──────────
if (!HAS_SESSION) {
  console.log(`\n── [${runtimeId}] 第二轮：转写注入记忆验证 ──`);
  const ev2 = await send('我上一轮让你记住的暗号是什么？直接回答，不用调工具。');
  const texts2 = ev2.filter((e) => e.kind === 'text').map((e) => e.text ?? '');
  check('跨轮记忆（转写注入）', texts2.join('').includes('青橙紫'),
    texts2.join('').slice(0, 80).replace(/\n/g, ' '));
  check('无 error 事件', ev2.filter((e) => e.kind === 'error').length === 0);
} else if (HAS_SESSION && session?.sessionId) {
  console.log(`\n── [${runtimeId}] 第二轮：续接验证 ──`);
  const ev2 = await send('再调用 ggb_get_state 确认一下画布，然后一句话总结。', session.sessionId);
  const kinds2 = {};
  for (const e of ev2) kinds2[e.kind] = (kinds2[e.kind] ?? 0) + 1;
  console.log('kinds:', JSON.stringify(kinds2));
  const texts2 = ev2.filter((e) => e.kind === 'text').map((e) => e.text ?? '');
  const done2 = ev2.find((e) => e.kind === 'done');
  check('续接有回复', texts2.join('').length > 0, texts2.join('').slice(0, 60).replace(/\n/g, ' '));
  if (texts2.join('').length === 0) {
    for (const e of ev2.slice(0, 8)) console.log('  [ev2]', JSON.stringify(e).slice(0, 160));
  }
  if (EXPECT_TOOL_EVENTS) {
    const results2 = ev2.filter((e) => e.kind === 'tool-result');
    check('续接轮工具调用成功（审批放行）', results2.length > 0 && results2.every((r) => !r.isError),
      results2.map((r) => (r.isError ? '✗' : '✓')).join(''));
  }
  check('续接后 sessionId 保持', done2?.sessionId === session.sessionId, done2?.sessionId ?? '(无)');
}

// ── 第三轮：题目图片（视觉识题 / dsh 降级）────────────────────
console.log(`\n── [${runtimeId}] 第三轮：发题目图 ──`);
{
  const ev3 = await send('用一句话说这道题的图画了什么、求什么。', undefined, [caseImage]);
  const joined = ev3.filter((e) => e.kind === 'text').map((e) => e.text ?? '').join('');
  const errors3 = ev3.filter((e) => e.kind === 'error');
  if (HAS_SESSION) {
    check('识图说出题意', /椭圆|面积|三角形|动点/.test(joined), joined.slice(0, 80).replace(/\n/g, ' '));
  } else {
    check('看不了图时如实降级', /看不到|文字|描述/.test(joined), joined.slice(0, 80).replace(/\n/g, ' '));
  }
  check('无 error 事件', errors3.length === 0, errors3.map((e) => e.message).join(' | ').slice(0, 100));
}

console.log(failed === 0 ? `\n[${runtimeId}] 路由冒烟通过` : `\n[${runtimeId}] 路由冒烟失败（${failed} 项）`);
process.exit(failed === 0 ? 0 : 1);
