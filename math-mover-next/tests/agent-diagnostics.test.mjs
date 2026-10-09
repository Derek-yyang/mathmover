import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/agent-diagnostics.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const { agentFailure, agentResponseError, redactAgentError } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('HTTP 401/503 alone do not invent a login or installation diagnosis', () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const result = agentFailure({ stage: 'request', message: '没有具体信息', status });
    assert.equal(result.kind, 'unknown');
    assert.match(result.title, new RegExp(String(status)));
  }
});
test('explicit CLI authentication and launch reports get actionable, qualified guidance', () => {
  assert.equal(agentFailure({ stage: 'runtime', message: 'authentication failed', runtimeId: 'codex' }).kind, 'authentication');
  assert.equal(agentFailure({ stage: 'runtime', message: '启动 Claude Code 失败: spawn claude ENOENT' }).kind, 'launch');
  assert.equal(agentFailure({ stage: 'request', message: 'Failed to fetch' }).kind, 'communication');
  const missing = agentFailure({ stage: 'request', message: '你选的 agent 当前不可用：要么没安装，要么起不来。' });
  assert.equal(missing.kind, 'unavailable');
  assert.match(missing.guidance, /未区分未安装和启动失败/);
});
test('generic exits, timeouts and failures remain unknown rather than being guessed', () => {
  for (const message of ['退出码 1', 'model refused', '请求超时', '']) {
    assert.equal(agentFailure({ stage: 'runtime', message }).kind, 'unknown');
  }
  assert.equal(agentFailure({ stage: 'request', message: 'unauthorized' }).kind, 'unknown');
  assert.equal(agentFailure({ stage: 'detect', message: 'HTTP 500' }).kind, 'detection');
});
test('JSON and NDJSON error bodies preserve the route explanation; HTML is not exposed', () => {
  assert.equal(agentResponseError('{"error":"服务错误"}'), '服务错误');
  assert.equal(agentResponseError('{"error":{"message":"服务错误"}}'), '服务错误');
  assert.equal(agentResponseError('{"kind":"raw"}\n{"kind":"error","message":"当前不可用"}\n'), '当前不可用');
  assert.match(agentResponseError('<html>private crash trace</html>'), /尚未确认/);
  assert.doesNotMatch(agentResponseError('<html>private crash trace</html>'), /private/);
});
test('common credential patterns are redacted before diagnostics are stored', () => {
  const detail = 'Authorization: Bearer test-bearer-value\nANTHROPIC_API_KEY=private-key-value\n{"api_key":"json-key-value"}\nhttps://user:private-password@example.test/?access_token=query-token-value\nsecret=secret-value\nTOKEN=generic-token-value\nsk-proj-secretvalue12345678';
  const result = agentFailure({ stage: 'runtime', message: detail, runtimeId: 'claude-code' });
  assert.equal(result.runtimeId, 'claude-code');
  for (const value of ['test-bearer-value', 'private-key-value', 'json-key-value', 'private-password', 'query-token-value', 'secret-value', 'generic-token-value', 'sk-proj-secretvalue12345678']) {
    assert.ok(!result.detail.includes(value), value);
  }
  assert.equal(redactAgentError('x'.repeat(9000)).length, 4000);
  assert.equal(redactAgentError('\u001b[31merror\u001b[0m'), 'error');
});
