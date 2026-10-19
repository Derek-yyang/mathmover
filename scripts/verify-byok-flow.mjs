import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// BYOK 验收分两段：
//  A. 浏览器 UI：设置表单保存（密钥进应用数据目录、界面只显示尾 4 位）+ 设置页切换 Agent；
//  B. API 集成：配置写入 /api/byok 后直打 /api/agent 跑完整内置位通路——路由分支、
//     mcp-stdio 工具闭环、NDJSON 事件、轮次语义。工具只用只读的 ggb_get_state，
//     不写画布、不写课件库、不调真实模型（假 LLM 端点在本脚本内起）。
//
// 2026-10-18 起内置位是**自带分发的 OpenCode**（不再是自研循环），三处随之改了：
//  - 工具名在 opencode 那边是 `<server>_<工具>`，所以假 LLM 要回 `mathmover_ggb_get_state`；
//  - 工具面里**没有** read/write_construction 了（agent 自带 Read/Edit）；
//  - 端点收到的是 OpenAI 兼容的**完整 chunk 形状**（@ai-sdk/openai-compatible 会校验字段，
//    旧循环是手写的所以吃最简 delta）。
// 结束时还原配置；**还原放在 finally 里**——断言失败时也要还原，否则会把你自己的端点
// 留在脚本起的那个假端点上。
const calls = [];
const chunk = (delta, finish = null) => `data: ${JSON.stringify({
  id: 'chatcmpl-1', object: 'chat.completion.chunk', created: 0, model: 'test-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
})}\n\n`;
// ⚠ opencode 的**第一次请求不带 tools**（起会话标题那类旁路调用）。假模型必须按
// 「这次请求带没带工具」来决定回什么——照着调用序号回，工具调用会落到那一次上被丢掉，
// 真带工具的那轮反而拿到纯文本，于是永远走不到工具闭环（实测踩过）。
let toolRounds = 0;
const fakeLlm = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunkText) => { body += chunkText; });
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    calls.push(parsed);
    const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;
    res.setHeader('content-type', 'text/event-stream');
    if (!hasTools) {
      res.write(chunk({ role: 'assistant', content: '标题' }, 'stop'));
    } else if (toolRounds++ === 0) {
      res.write(chunk({ role: 'assistant', content: '读取画板…' }));
      res.write(chunk({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'mathmover_ggb_get_state', arguments: '{"png":false}' } }] }));
      res.write(chunk({}, 'tool_calls'));
    } else {
      res.write(chunk({ role: 'assistant', content: '画布已读取，构造完成。' }, 'stop'));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise((resolve) => fakeLlm.listen(0, resolve));
const llmPort = fakeLlm.address().port;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1544, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

const byokUrl = 'http://localhost:3000/api/byok';
const post = (body) => fetch(byokUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then((r) => r.json());

// 提到 try 外面：finally 里要拿它们还原配置（声明在 try 内的话，早期失败会撞 TDZ）
let original = null;
let wroteKey = false;

try {
  original = await fetch(byokUrl).then((r) => r.json());
  assert.ok(original && typeof original.apiKeyConfigured === 'boolean', 'GET returns the masked shape');
  assert.ok(!('apiKey' in original), '完整 key 永不回传');

  await page.route('**/api/coursewares**', (route) => route.fulfill({ json: { records: [] } }));
  await stubConstructionDraft(page);
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('textbox', { name: '题目描述' }).waitFor({ timeout: 60_000 });

  // A1. 设置表单：开设置 → 切「模型 API」Tab → 填端点/模型并保存
  const byokHeading = page.getByRole('heading', { name: '内置 Agent' });
  for (let attempt = 0; attempt < 4 && !(await byokHeading.count()); attempt++) {
    await page.getByRole('button', { name: '设置', exact: true }).click({ timeout: 2_000 }).catch(() => {});
    await page.getByRole('tab', { name: '模型 API', exact: true }).click({ timeout: 2_000 }).catch(() => {});
    await byokHeading.waitFor({ timeout: 2_000 }).catch(() => {});
  }
  await byokHeading.waitFor({ timeout: 10_000 });
  // 表单控件按**结构**定位，不按 placeholder/文案——那两样是会随产品文案改动的，
  // 而「端点/模型/密钥三个框」是这张卡的契约。同一个 panel 里各只有一个。
  const providerPanel = page.getByRole('tabpanel');
  await providerPanel.locator('input[type="url"]').fill(`http://127.0.0.1:${llmPort}/v1`);
  // 取**第一个** text 输入：模型行在推理档位行之前（两行都是 type=text）。
  await providerPanel.locator('input[type="text"]').first().fill('test-model');
  if (!original.apiKeyConfigured) {
    await providerPanel.locator('input[type="password"]').fill('test-key-4321');
    wroteKey = true;
  }
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor();
  const afterSave = await fetch(byokUrl).then((r) => r.json());
  assert.equal(afterSave.model, 'test-model', 'config persisted in app data dir');
  if (wroteKey) {
    assert.equal(afterSave.apiKeyTail, '4321', 'tail reflected back');
    assert.ok(!(await (await fetch(byokUrl)).text()).includes('test-key'), 'masked view never leaks the key body');
  }
  // A2. 设置页能切到内置 Agent，聊天标题只展示当前名称
  // 用前缀匹配而不是精确文案：卡片名会随产品文案变（「内置 Agent」/「内置 Agent（OpenCode）」）
  const useByok = page.getByRole('button', { name: /^使用 / });
  if (await useByok.count()) await useByok.first().click();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.locator('span[aria-label^="当前 Agent："]').waitFor();
  assert.equal(await page.getByRole('combobox', { name: '选择 Agent' }).count(), 0);

  // B. API 集成：完整内置位通路（配置来自服务端配置仓，请求体不带 key）
  // 带硬超时：流没结束就明着失败，别把脚本挂在这儿（实测挂过）
  const res = await fetch('http://localhost:3000/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '画一个点', runtimeId: 'byok', history: [] }),
    signal: AbortSignal.timeout(120_000),
  });
  assert.equal(res.status, 200, 'built-in run establishes the NDJSON stream');
  const stream = await res.text();
  const events = stream.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.kind === 'text-delta'), 'deltas surfaced as text-delta');
  assert.ok(events.some((e) => e.kind === 'tool-call'), 'tool-call event streamed');
  assert.ok(events.some((e) => e.kind === 'tool-result'), 'tool-result event streamed');
  assert.ok(events.some((e) => e.kind === 'done'), 'done event streamed');

  // LLM 侧闭环：工具声明齐全（名字带 opencode 的 server 前缀）、回喂 role:'tool'、stream:true。
  // 注意带工具的那次**未必是第一次调用**（opencode 先发一次不带工具的旁路请求）。
  const toolCall = calls.find((c) => Array.isArray(c.tools) && c.tools.length > 0);
  assert.ok(toolCall, '至少一次请求声明了工具');
  const toolNames = toolCall.tools.map((t) => t.function?.name ?? t.name);
  for (const name of ['mathmover_ggb_get_state', 'mathmover_ggb_apply', 'mathmover_get_expert_prompt', 'mathmover_get_sop_cards']) {
    assert.ok(toolNames.includes(name), `tools declared: ${name}`);
  }
  // 已删的那对兜底工具**不该**再出现（agent 自带 Read/Edit）
  assert.ok(!toolNames.some((n) => /read_construction|write_construction/.test(n ?? '')),
    'read/write_construction 已随自研循环删除，不该再声明给 agent');
  assert.equal(toolCall.stream, true, 'completions requested as a stream');
  const fedBack = calls.find((c) => c.messages?.at(-1)?.role === 'tool');
  assert.ok(fedBack, 'tool result fed back to the model');

  // 未配置时如实拒绝。
  // ⚠ **不要**传 apiKey: null —— 那是"清除密钥"语义，会把用户自己的 key 抹掉；
  // 掩码设计下已存 key 拿不回本体，抹了就真没了。不传 = 保留原 key。
  await post({ baseUrl: '', model: '' });
  const bad = await fetch('http://localhost:3000/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'x', runtimeId: 'byok', history: [] }),
  });
  assert.equal(bad.status, 400, 'unconfigured byok is rejected with 400');

  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ maskedGet: true, configSaved: true, tailShown: wroteKey, selectorSwitch: true,
    byokStreamOk: true, toolRoundTrip: true, toolsDeclared: toolNames.length, toolResultFedBack: true,
    unconfiguredRejected: true, completions: calls.length, restored: true, browserErrors: errors.length }));
} finally {
  // 还原配置放 finally：断言失败时也要还原，否则会把你自己的端点留在假端点上。
  // key 仅在本次写过且原本没有时清除（掩码设计下已存 key 拿不回本体）。
  try { await post({ baseUrl: original.baseUrl, model: original.model, apiKey: wroteKey ? null : undefined }); }
  catch { /* 服务已停等：还原失败不该盖住原始失败 */ }
  await browser.close();
  fakeLlm.close();
}
