import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const compile = name => ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const url = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const { metaFromToolCall, toolBaseName, CATEGORY_LABEL, mergeRunMeta } = await import(url(compile('agent-run-meta')));

test('toolBaseName 把 mcp 前缀去掉', () => {
  assert.equal(toolBaseName('mcp__mathmover__submit_construction'), 'submit_construction');
  assert.equal(toolBaseName('submit_construction'), 'submit_construction');
  assert.equal(toolBaseName(undefined), '');
});

test('submit_construction 的 title 入参成为 meta.title', () => {
  const m = metaFromToolCall('submit_construction', { title: '抛物线与直线相交', commands: ['A=(0,0)'] });
  assert.equal(m.title, '抛物线与直线相交');
});

test('title 去首尾空白并截断到 60 字，空的不写', () => {
  assert.equal(metaFromToolCall('submit_construction', { title: '  前后有空白  ' }).title, '前后有空白');
  assert.equal(metaFromToolCall('submit_construction', { title: 'x'.repeat(100) }).title.length, 60);
  assert.equal(metaFromToolCall('submit_construction', { title: '   ' }).title, undefined);
  assert.equal(metaFromToolCall('submit_construction', {}).title, undefined);
});

test('category 入参带上显示名', () => {
  const m = metaFromToolCall('submit_construction', { category: 'B' });
  assert.equal(m.category, 'B');
  assert.equal(m.categoryLabel, CATEGORY_LABEL.B);
});

test('自由画图不给 category 时，meta 不带 category', () => {
  // 这正是两条链路的分野：submit_construction 在自由画图下只给 commands
  const m = metaFromToolCall('submit_construction', { commands: ['A=(0,0)'] });
  assert.equal(m.category, undefined);
  assert.equal(m.categoryLabel, undefined);
});

test('非法 category 不写（只认 A/B/C/D）', () => {
  assert.equal(metaFromToolCall('submit_construction', { category: 'E' }).category, undefined);
  assert.equal(metaFromToolCall('submit_construction', { category: 3 }).category, undefined);
});

test('get_expert_prompt 也能带出类别', () => {
  const m = metaFromToolCall('get_expert_prompt', { category: 'A' });
  assert.equal(m.category, 'A');
  assert.equal(m.categoryLabel, CATEGORY_LABEL.A);
});

test('mcp 前缀形式同样识别', () => {
  assert.equal(metaFromToolCall('mcp__mathmover__submit_construction', { title: 'x' }).title, 'x');
});

test('无关工具不产出任何 meta', () => {
  assert.deepEqual(metaFromToolCall('ggb_apply', { title: '不该被取', category: 'A' }), {});
  assert.deepEqual(metaFromToolCall('Read', { title: 'x' }), {});
  assert.deepEqual(metaFromToolCall(undefined, { title: 'x' }), {});
});

test('mergeRunMeta 只覆盖有值字段，空 patch 不动 meta', () => {
  const base = { status: 'generating', title: '旧名' };
  assert.equal(mergeRunMeta(base, {}), base);
  assert.deepEqual(mergeRunMeta(base, { title: '新名' }), { status: 'generating', title: '新名' });
  // 首次写入时 meta 可能是 undefined
  assert.deepEqual(mergeRunMeta(undefined, { title: 'x' }), { title: 'x' });
});
