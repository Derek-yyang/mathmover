import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/agent-picker.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const { modelPresentation, effortDisplay } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('modelPresentation 把来源与映射拆到说明行，名字保持短', () => {
  assert.deepEqual(modelPresentation('gpt-6.1-sol（config.toml）'),
    { name: 'gpt-6.1-sol', detail: '来自 config.toml' });
  assert.deepEqual(modelPresentation('默认（用 CLI 自己的配置）'),
    { name: '默认', detail: '使用 Agent 的默认配置' });
  // 映射说明（→ 之后）整段留第二行，含括号注释
  assert.deepEqual(modelPresentation('Opus → claude-opus-5[1M]（claude-haiku-5-5）'),
    { name: 'Opus', detail: 'claude-opus-5[1M]（claude-haiku-5-5）' });
  assert.deepEqual(modelPresentation('claude-fable-5'), { name: 'claude-fable-5', detail: '' });
  assert.deepEqual(modelPresentation('GPT-6.1-Sol'), { name: 'GPT-6.1-Sol', detail: '' });
});

test('effortDisplay：没选过用默认标记（agent 配置生效值），显示未钉住', () => {
  const options = [{ id: 'low', label: 'low' }, { id: 'high', label: 'high', default: true }];
  const shown = effortDisplay(options, undefined);
  assert.deepEqual(shown, { option: options[1], pinned: false });
  // 选过的值已失效（换模型残留）→ 回落默认，不显示幽灵值
  assert.equal(effortDisplay(options, 'ultra').pinned, false);
  assert.equal(effortDisplay(options, 'ultra').option.id, 'high');
});

test('effortDisplay：显式选过用它并标 pinned', () => {
  const options = [{ id: 'low', label: 'low', default: true }, { id: 'high', label: 'high' }];
  assert.deepEqual(effortDisplay(options, 'high'), { option: options[1], pinned: true });
});

test('effortDisplay：没有默认标记时第一项兜底；没有清单返回 null', () => {
  assert.equal(effortDisplay([{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], undefined).option.id, 'a');
  assert.equal(effortDisplay([], 'x'), null);
  assert.equal(effortDisplay(undefined, 'x'), null);
});
