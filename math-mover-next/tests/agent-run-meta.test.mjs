import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const compile = name => ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const url = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const { metaFromToolCall, toolBaseName, CATEGORY_LABEL, mergeRunMeta } = await import(url(compile('agent-run-meta')));

test('toolBaseName 把 mcp 前缀去掉', () => {
  assert.equal(toolBaseName('mcp__mathmover__get_expert_prompt'), 'get_expert_prompt');
  assert.equal(toolBaseName('ggb_apply'), 'ggb_apply');
  assert.equal(toolBaseName(undefined), '');
});

test('get_expert_prompt 的 category 入参成为 meta.category + 显示名', () => {
  const m = metaFromToolCall('get_expert_prompt', { category: 'A' });
  assert.equal(m.category, 'A');
  assert.equal(m.categoryLabel, CATEGORY_LABEL.A);
});

test('mcp 前缀形式同样识别', () => {
  assert.equal(metaFromToolCall('mcp__mathmover__get_expert_prompt', { category: 'B' }).category, 'B');
});

test('不给 category 时，meta 不带 category', () => {
  const m = metaFromToolCall('get_expert_prompt', {});
  assert.equal(m.category, undefined);
  assert.equal(m.categoryLabel, undefined);
});

test('非法 category 不写（只认 A/B/C/D）', () => {
  assert.equal(metaFromToolCall('get_expert_prompt', { category: 'E' }).category, undefined);
  assert.equal(metaFromToolCall('get_expert_prompt', { category: 3 }).category, undefined);
});

test('课件名不再从工具入参取——它走正文标记（route 剥出来发 title 事件）', () => {
  // 2026-10-15：收卷工具删除，命名改走 <mm-title> 标记。工具入参里再出现 title 一律不认。
  assert.equal(metaFromToolCall('get_expert_prompt', { title: '不该被取' }).title, undefined);
  assert.equal(metaFromToolCall('ggb_apply', { title: '不该被取' }).title, undefined);
});

test('无关工具不产出任何 meta', () => {
  assert.deepEqual(metaFromToolCall('ggb_apply', { category: 'A' }), {});
  assert.deepEqual(metaFromToolCall('Read', { category: 'A' }), {});
  assert.deepEqual(metaFromToolCall(undefined, { category: 'A' }), {});
});

test('mergeRunMeta 只覆盖有值字段，空 patch 不动 meta', () => {
  const base = { status: 'generating', title: '旧名' };
  assert.equal(mergeRunMeta(base, {}), base);
  assert.deepEqual(mergeRunMeta(base, { title: '新名' }), { status: 'generating', title: '新名' });
  // 首次写入时 meta 可能是 undefined
  assert.deepEqual(mergeRunMeta(undefined, { title: 'x' }), { title: 'x' });
});
