import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const compile = name => ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const url = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const progress = compile('agent-progress').replace("'./agent-diagnostics'", JSON.stringify(url(compile('agent-diagnostics'))));
const runMeta = compile('agent-run-meta').replace("'@/components/dashboard/types'", JSON.stringify(url('export {};')));
const code = compile('agent-run-presentation')
  .replace("'./agent-progress'", JSON.stringify(url(progress)))
  .replace("'./agent-run-meta'", JSON.stringify(url(runMeta)));
const { executionPresentation, runResultPresentation } = await import(url(code));
const run = (steps, status = 'completed') => ({ status, steps, startedAt: 1000, endedAt: 2000 });
const step = (name, status = 'returned') => ({ id: name, name, status });

test('current activity follows the latest concurrent running call, never an invented phase', () => {
  const result = executionPresentation(run([step('ggb_get_state', 'running'), step('ggb_apply', 'running')], 'running'));
  assert.equal(result.label, '正在更新构造并自检…');
  assert.equal(executionPresentation(run([], 'running')).label, '处理中…');
});

test('returned calls never stay current; earlier concurrent work remains active', () => {
  assert.equal(executionPresentation(run([step('ggb_get_state', 'running'), step('ggb_apply')], 'running')).label, '正在读取画板…');
  assert.equal(executionPresentation(run([step('ggb_get_state'), step('ggb_apply')], 'running')).label, '更新构造并自检 · 已返回');
  assert.equal(executionPresentation(run([step('Bash', 'running')], 'running')).label, '正在执行命令…');
  assert.equal(executionPresentation(run([step('unknown', 'running')], 'running')).label, '正在调用工具…');
});

test('fast results retain a readable, truthful summary until the next activity', () => {
  assert.equal(executionPresentation(run([step('ggb_get_state')], 'running')).label, '读取画板 · 已返回');
  assert.equal(executionPresentation(run([step('ggb_apply', 'error')], 'running')).label, '更新构造并自检 · 返回错误');
  assert.equal(executionPresentation(run([step('ggb_apply', 'unconfirmed')], 'running')).label, '更新构造并自检 · 未确认');
  const calls = [{ ...step('Read'), endedAt: 4000 }, { ...step('Bash'), endedAt: 3000 }];
  assert.equal(executionPresentation(run(calls, 'running')).label, '读取文件 · 已返回');
  assert.equal(executionPresentation(run([...calls, step('ggb_apply', 'running')], 'running')).label, '正在更新构造并自检…');
  assert.equal(executionPresentation(run(calls, 'completed')).label, '本轮已结束');
  assert.equal(executionPresentation(run(calls, 'stopped')).label, '已停止 · 本轮未跑完');
});

test('tool errors, missing results and interrupted runs remain distinct from success', () => {
  assert.equal(executionPresentation(run([step('ggb_apply', 'error')])).warning, true);
  assert.equal(executionPresentation(run([step('ggb_apply', 'unconfirmed')])).uncertain, true);
  assert.equal(executionPresentation(run([], 'error')).label, '本轮中断');
  assert.equal(executionPresentation(run([], 'unconfirmed')).uncertain, true);
});

test('returned construction calls never imply an object audit passed', () => {
  // 按**工具名**判「是不是构造类」，不按展示标签——标签是给人看的措辞，改文案不该让这里失效
  const result = runResultPresentation({ execution: run([step('mcp__mathmover__ggb_apply')]) });
  assert.equal(result.check, '未检查');
  assert.equal(result.checked, false);
  assert.equal(runResultPresentation({ execution: run([step('ggb_get_state')]) }), null);
  assert.equal(runResultPresentation({ status: 'completed' }), null);
});

test('incomplete audits and named object issues are not hidden by a completed run', () => {
  const missing = { name: 'A', kind: 'missing', line: 'A=(0,0)' };
  const undefinedObject = { name: 'f', kind: 'undefined', line: 'f(x)=1/0' };
  const audit = { missing: [missing], undefinedObjs: [undefinedObject], findings: [missing, undefinedObject], degraded: true };
  const result = runResultPresentation({ auditResult: audit, execution: run([]) });
  assert.equal(result.check, '发现 2 个对象问题');
  assert.deepEqual(result.issues.map(f => f.name), ['A', 'f']);
  assert.equal(result.degraded, true);
  assert.equal(result.warning, true);
  assert.equal(audit.missing.length, 1);
  assert.equal(runResultPresentation({ auditResult: { ...audit, missing: [], undefinedObjs: [] } }).check, '检查不完整');
});

test('clean audit claims only absence of object issues, and active runs have no final result', () => {
  const meta = { status: 'completed', commands: ['A=(0,0)'], categoryLabel: '平面几何',
    auditResult: { missing: [], undefinedObjs: [], findings: [], degraded: false } };
  const result = runResultPresentation(meta);
  assert.equal(result.check, '未发现对象缺失或数值异常');
  assert.equal(result.commands, 1);
  assert.equal(result.category, '平面几何');
  assert.equal(runResultPresentation({ ...meta, status: 'generating' }), null);
  assert.equal(runResultPresentation({ ...meta, execution: run([], 'running') }), null);
});

test('user-stopped runs are neither success nor failure', () => {
  const result = executionPresentation(run([], 'stopped'));
  assert.equal(result.label, '已停止 · 本轮未跑完');
  assert.equal(result.warning, false);
  assert.equal(result.uncertain, false);
});
