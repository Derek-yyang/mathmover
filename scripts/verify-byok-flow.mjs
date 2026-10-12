import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';

// BYOK 验收分两段：
//  A. 浏览器 UI：设置表单保存（密钥只进 localStorage）+ 选择器切换；
//  B. API 集成：直打 /api/agent 跑完整 BYOK 循环——路由分支、配置校验、
//     mcp-stdio 工具闭环、NDJSON 事件流。工具只用只读的 ggb_get_state，
//     不写画布、不写课件库、不调真实模型（假 LLM 端点在本脚本内起）。
// UI 发送路径依赖画布已连（headless 页画布不连 daemon，产品 503 是正确行为），
// 该段覆盖到表单与选择器为止。
const calls = [];
const fakeLlm = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    calls.push(JSON.parse(body || '{}'));
    res.setHeader('content-type', 'application/json');
    if (calls.length === 1) {
      res.end(JSON.stringify({ choices: [{ message: { tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'ggb_get_state', arguments: '{"png":false}' } },
      ] } }] }));
    } else {
      res.end(JSON.stringify({ choices: [{ message: { content: '画布已读取，构造完成。' } }] }));
    }
  });
});
await new Promise((resolve) => fakeLlm.listen(0, resolve));
const llmPort = fakeLlm.address().port;
const byok = { baseUrl: `http://127.0.0.1:${llmPort}/v1`, apiKey: 'test-key', model: 'test-model' };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1544, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  await page.route('**/api/coursewares**', (route) => route.fulfill({ json: { records: [] } }));
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('textbox', { name: '题目描述' }).waitFor({ timeout: 60_000 });

  // A1. 设置表单：水合前点按钮无效——重试到弹层出现
  const byokHeading = page.getByRole('heading', { name: '内置构造 Agent（BYOK）' });
  for (let attempt = 0; attempt < 4 && !(await byokHeading.count()); attempt++) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await byokHeading.waitFor({ timeout: 3_000 }).catch(() => {});
  }
  await byokHeading.waitFor({ timeout: 10_000 });
  await page.getByPlaceholder('https://api.openai.com/v1 或 http://127.0.0.1:15721/v1').fill(byok.baseUrl);
  await page.getByPlaceholder('端点认得的模型 id').fill(byok.model);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor();
  const stored = await page.evaluate(() => localStorage.getItem('mm.byok'));
  assert.ok(stored?.includes('test-model'), 'config persisted to localStorage');
  await page.getByRole('button', { name: '关闭设置' }).click();

  // A2. 选择器能切到内置构造 Agent（且它不带「未安装/未登录」后缀）
  const sel = page.getByRole('combobox', { name: '选择 Agent' });
  await sel.selectOption({ label: '内置构造 Agent（BYOK）' });

  // B. API 集成：完整 BYOK 循环（不带 windowId——绕开画布连接前置，工具只读）
  const res = await fetch('http://localhost:3000/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '画一个点', runtimeId: 'byok', byok, history: [] }),
  });
  assert.equal(res.status, 200, 'byok run establishes the NDJSON stream');
  const stream = await res.text();
  const events = stream.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes('tool-call'), 'tool-call event streamed');
  assert.ok(kinds.includes('tool-result'), 'tool-result event streamed');
  assert.ok(events.some((e) => e.kind === 'text' && e.text.includes('画布已读取')), 'final text streamed');
  assert.ok(events.some((e) => e.kind === 'done'), 'done event streamed');

  // LLM 侧闭环：工具声明齐全、回喂 role:'tool'
  assert.equal(calls.length, 2, 'two completions (tool round + final)');
  const toolNames = (calls[0].tools ?? []).map((t) => t.function?.name);
  for (const name of ['ggb_get_state', 'ggb_apply', 'submit_construction']) {
    assert.ok(toolNames.includes(name), `tools declared: ${name}`);
  }
  assert.equal(calls[0].model, 'test-model');
  assert.equal(calls[1].messages.at(-1).role, 'tool', 'tool result fed back to the model');

  // 未配置时如实拒绝
  const bad = await fetch('http://localhost:3000/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'x', runtimeId: 'byok', byok: {}, history: [] }),
  });
  assert.equal(bad.status, 400, 'unconfigured byok is rejected with 400');

  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ configSaved: true, selectorSwitch: true, byokStreamOk: true,
    toolRoundTrip: true, toolsDeclared: toolNames.length, toolResultFedBack: true,
    unconfiguredRejected: true, completions: calls.length, browserErrors: errors.length }));
} finally {
  await browser.close();
  fakeLlm.close();
}
