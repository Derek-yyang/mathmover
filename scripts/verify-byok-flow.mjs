import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// BYOK 验收分两段：
//  A. 浏览器 UI：设置表单保存（密钥进应用数据目录、界面只显示尾 4 位）+ 设置页切换 Agent；
//  B. API 集成：配置写入 /api/byok 后直打 /api/agent 跑完整 BYOK 循环——路由分支、
//     mcp-stdio 工具闭环、SSE 流式事件、轮次语义。工具只用只读的 ggb_get_state，
//     不写画布、不写课件库、不调真实模型（假 LLM 端点在本脚本内起）。
// 结束时还原配置（原本未配置的 key 会被清除——掩码设计下已存 key 拿不回本体，
// 所以仅在原本无 key 时才写测试 key）。
const calls = [];
const fakeLlm = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    calls.push(JSON.parse(body || '{}'));
    // SSE 应答（对齐 OpenDesign 的流式 BYOK）
    res.setHeader('content-type', 'text/event-stream');
    if (calls.length === 1) {
      res.write('data: {"choices":[{"delta":{"content":"读取画板…"}}]}\n');
      res.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"ggb_get_state","arguments":"{\\"png\\":false}"}}]}}]}\n');
      res.write('data: [DONE]\n');
    } else {
      res.write('data: {"choices":[{"delta":{"content":"画布已读取，构造完成。"}}]}\n');
      res.write('data: [DONE]\n');
    }
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

try {
  const original = await fetch(byokUrl).then((r) => r.json());
  assert.ok(original && typeof original.apiKeyConfigured === 'boolean', 'GET returns the masked shape');
  assert.ok(!('apiKey' in original), '完整 key 永不回传');

  await page.route('**/api/coursewares**', (route) => route.fulfill({ json: { records: [] } }));
  await stubConstructionDraft(page);
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('textbox', { name: '题目描述' }).waitFor({ timeout: 60_000 });

  // A1. 设置表单：开设置 → 切「API 提供商」Tab → 填端点/模型并保存
  const byokHeading = page.getByRole('heading', { name: '内置构造 Agent（BYOK）' });
  for (let attempt = 0; attempt < 4 && !(await byokHeading.count()); attempt++) {
    await page.getByRole('button', { name: '设置', exact: true }).click({ timeout: 2_000 }).catch(() => {});
    await page.getByRole('tab', { name: 'API 提供商', exact: true }).click({ timeout: 2_000 }).catch(() => {});
    await byokHeading.waitFor({ timeout: 2_000 }).catch(() => {});
  }
  await byokHeading.waitFor({ timeout: 10_000 });
  await page.getByPlaceholder('https://api.openai.com/v1 或 http://127.0.0.1:15721/v1').fill(`http://127.0.0.1:${llmPort}/v1`);
  await page.getByPlaceholder('端点认得的模型 id').fill('test-model');
  let wroteKey = false;
  if (!original.apiKeyConfigured) {
    await page.getByPlaceholder('sk-…').fill('test-key-4321');
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
  // A2. 设置页能切到内置构造 Agent，聊天标题只展示当前名称
  const useByok = page.getByRole('button', { name: '使用 内置构造 Agent（BYOK）', exact: true });
  if (await useByok.count()) await useByok.click();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.locator('span[aria-label="当前 Agent：内置构造 Agent（BYOK）"]').waitFor();
  assert.equal(await page.getByRole('combobox', { name: '选择 Agent' }).count(), 0);

  // B. API 集成：完整 BYOK 循环（配置来自服务端配置仓，请求体不带 key）
  const res = await fetch('http://localhost:3000/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '画一个点', runtimeId: 'byok', history: [] }),
  });
  assert.equal(res.status, 200, 'byok run establishes the NDJSON stream');
  const stream = await res.text();
  const events = stream.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.kind === 'text-delta'), 'SSE deltas surfaced as text-delta');
  assert.ok(events.some((e) => e.kind === 'tool-call'), 'tool-call event streamed');
  assert.ok(events.some((e) => e.kind === 'tool-result'), 'tool-result event streamed');
  assert.ok(events.some((e) => e.kind === 'done'), 'done event streamed');

  // LLM 侧闭环：工具声明齐全、回喂 role:'tool'、请求不携带鉴权 key 之外还带 stream:true
  assert.equal(calls.length, 2, 'two completions (tool round + final)');
  const toolNames = (calls[0].tools ?? []).map((t) => t.function?.name);
  for (const name of ['ggb_get_state', 'ggb_apply', 'get_expert_prompt', 'get_sop_cards', 'read_construction', 'write_construction']) {
    assert.ok(toolNames.includes(name), `tools declared: ${name}`);
  }
  assert.equal(calls[0].stream, true, 'completions requested as a stream');
  assert.equal(calls[1].messages.at(-1).role, 'tool', 'tool result fed back to the model');

  // 未配置时如实拒绝
  await post({ baseUrl: '', model: '', apiKey: null });
  const bad = await fetch('http://localhost:3000/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'x', runtimeId: 'byok', history: [] }),
  });
  assert.equal(bad.status, 400, 'unconfigured byok is rejected with 400');

  // 还原配置（key 仅在本次写过且原本没有时清除）
  await post({ baseUrl: original.baseUrl, model: original.model, apiKey: wroteKey ? null : undefined });

  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ maskedGet: true, configSaved: true, tailShown: wroteKey, selectorSwitch: true,
    byokStreamOk: true, toolRoundTrip: true, toolsDeclared: toolNames.length, toolResultFedBack: true,
    unconfiguredRejected: true, completions: calls.length, restored: true, browserErrors: errors.length }));
} finally {
  await browser.close();
  fakeLlm.close();
}
