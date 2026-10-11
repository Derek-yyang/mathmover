import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const compile = name => ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const url = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const code = compile('agent-progress').replace("'./agent-diagnostics'", JSON.stringify(url(compile('agent-diagnostics'))));
const { updateToolProgress: update, finishExecution: finish, toolStepLabel, elapsedLabel } = await import(url(code));
const fresh = () => ({ status: 'running', startedAt: 1000, steps: [] });

test('parallel tool calls correlate by ID, never by name or position', () => {
  const original = fresh();
  let run = update(original, { kind: 'tool-call', toolCallId: 'a', name: 'ggb_apply' }, 2000);
  run = update(run, { kind: 'tool-call', toolCallId: 'b', name: 'ggb_apply' }, 3000);
  run = update(run, { kind: 'tool-result', toolCallId: 'b', isError: true, output: 'SECRET' }, 4000);
  assert.equal(original.steps.length, 0);
  assert.equal(run.steps[0].status, 'running');
  assert.equal(run.steps[1].status, 'error');
  assert.equal('output' in run.steps[1], false);
  assert.equal(finish(run, 'completed', 5000).steps[0].status, 'unconfirmed');
  assert.equal(run.steps[0].status, 'running');
});

test('returned result is not a geometry validation claim; missing IDs do not guess a match', () => {
  let run = update(fresh(), { kind: 'tool-call', name: 'ggb_get_state' }, 2000);
  run = update(run, { kind: 'tool-result' }, 3000);
  assert.equal(run.steps[0].status, 'running');
  assert.equal(run.steps[1].status, 'returned');
  assert.equal(finish(run, 'completed', 4000).steps[0].status, 'unconfirmed');
});

test('duplicate calls/results preserve timing and explicit errors', () => {
  let run = update(fresh(), { kind: 'tool-call', toolCallId: 'a', name: 'ggb_apply' }, 2000);
  assert.equal(update(run, { kind: 'tool-call', toolCallId: 'a', name: 'ggb_apply' }, 3000), run);
  run = update(run, { kind: 'tool-result', toolCallId: 'a', isError: true }, 4000);
  run = update(run, { kind: 'tool-result', toolCallId: 'a', isError: false }, 5000);
  assert.equal(run.steps.length, 1);
  assert.equal(run.steps[0].status, 'error');
  assert.equal(run.steps[0].endedAt, 4000);
});

test('out-of-order result acquires late name without inventing a start time', () => {
  let run = update(fresh(), { kind: 'tool-result', toolCallId: 'a' }, 2000);
  run = update(run, { kind: 'tool-call', toolCallId: 'a', name: 'ggb_get_state' }, 3000);
  assert.equal(run.steps.length, 1);
  assert.equal(run.steps[0].name, 'ggb_get_state');
  assert.equal(run.steps[0].status, 'returned');
  assert.equal(run.steps[0].startedAt, undefined);
});

test('interruption or stream end leaves unmatched work unconfirmed', () => {
  let run = update(fresh(), { kind: 'tool-call', toolCallId: 'a', name: 'ggb_apply' }, 2000);
  for (const outcome of ['completed', 'error', 'unconfirmed']) {
    const ended = finish(run, outcome, 3000);
    assert.equal(ended.status, outcome);
    assert.equal(ended.steps[0].status, 'unconfirmed');
  }
  run = finish(run, 'error', 3000);
  run = update(run, { kind: 'tool-call', toolCallId: 'b', name: 'ggb_diff' }, 4000);
  assert.equal(run.steps[1].status, 'unconfirmed');
});

test('metadata excludes tool payloads and redacts credential-like names', () => {
  const run = update(fresh(), { kind: 'tool-call', toolCallId: 'a', name: 'API_KEY=private-test-secret', input: 'SECRET' }, 2000);
  assert.doesNotMatch(JSON.stringify(run), /private-test-secret|SECRET/);
  assert.equal(toolStepLabel('constructor'), '调用工具');
  assert.equal(toolStepLabel('ggb_apply'), '更新构造');
  assert.equal(update(run, { kind: 'thinking', text: 'SECRET' }, 3000), run);
});

test('elapsed text is local time only and tolerates backwards clocks', () => {
  assert.equal(toolStepLabel('mcp__mathmover__get_expert_prompt'), '读取建模规则');
  assert.equal(toolStepLabel('mcp__mathmover__submit_construction'), '提交构造并检查');
  assert.equal(elapsedLabel(1000, 2000), '1 秒');
  assert.equal(elapsedLabel(1000, 62000), '1 分 1 秒');
  assert.equal(elapsedLabel(2000, 1000), '0 秒');
});

