import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../lib/agent-activity.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { appendActivityText: append, classifyActivityText: classify, recordActivityTool: tool, settleActivity: settle } =
  await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const fresh = () => ({ id: 'run', role: 'assistant', content: '', createdAt: 1000, meta: { activity: [] } });

test('alternating narration and tools preserve order, while final text alone becomes the body', () => {
  let m = append(fresh(), { text: '先读画板', messageId: 'first' }, true);
  assert.equal(m.content, '');
  m = tool(m, 'read');
  m = append(m, { text: '再检查对象', messageId: 'second' }, true);
  m = classify(m, 'commentary', 'second');
  m = tool(m, 'check');
  m = append(m, { text: '椭圆已画好。', messageId: 'last', phase: 'final' }, true);
  m = settle(m, '椭圆已画好。');
  assert.equal(m.content, '椭圆已画好。');
  assert.deepEqual(m.meta.activity.map(e => e.kind), ['text', 'tool', 'text', 'tool', 'text']);
  assert.deepEqual(m.meta.activity.filter(e => e.kind === 'text').map(e => e.phase), ['commentary', 'commentary', 'final']);
  assert.deepEqual(settle(JSON.parse(JSON.stringify(m))), m, 'persisted classification survives reload');
});

test('message IDs scope late phase markers and an explicit answer is never moved by a later tool', () => {
  let m = append(fresh(), { text: '答案', messageId: 'a', phase: 'final' }, true);
  m = append(m, { text: '说明', messageId: 'b' }, true);
  m = classify(m, 'commentary', 'b');
  m = tool(m, 'call');
  assert.equal(m.content, '答案');
  assert.equal(m.meta.activity[0].phase, 'final');
});

test('buffered fragments join once; provisional text stays folded until an explicit final marker', () => {
  let m = append(fresh(), { text: '第一', messageId: 'x' });
  m = append(m, { text: '第二', messageId: 'x' });
  assert.equal(m.meta.activity.length, 1);
  assert.equal(m.content, '');
  m = classify(m, 'final', 'x');
  assert.equal(m.content, '第一第二');
  assert.equal(settle(m, '第一第二').meta.activity.length, 1);
});

test('missing classifications, cancellation and legacy histories do not lose content', () => {
  const legacy = { ...fresh(), content: '旧正文', meta: undefined };
  assert.equal(settle(legacy), legacy);
  const m = settle(append(fresh(), { text: '未分类的部分回答' }));
  assert.equal(m.content, '未分类的部分回答');
  assert.equal(m.meta.activity[0].phase, 'unknown');
});

test('authoritative done text is supported without choosing the last text as a final answer', () => {
  let m = append(fresh(), { text: '真正结果', messageId: 'result' }, true);
  m = append(m, { text: '未分类补充', messageId: 'other' }, true);
  m = settle(m, '真正结果');
  assert.equal(m.meta.activity[0].phase, 'final');
  assert.equal(m.meta.activity[1].phase, 'unknown');
  assert.equal(m.content, '真正结果\n\n未分类补充');
  const commentary = tool(append(fresh(), { text: '做到一半' }), 'call');
  assert.equal(settle(commentary, '做到一半').content, '', 'tool-round summary is never relabelled as final');
});

test('duplicate tool events neither reorder activity nor classify post-tool text as narration', () => {
  let m = tool(append(fresh(), { text: '准备读取' }), 'one');
  m = append(m, { text: '最终回复' });
  assert.equal(tool(m, 'one'), m);
  const afterResult = tool(m, 'unmatched-result', false);
  assert.equal(settle(afterResult).content, '最终回复');
});
