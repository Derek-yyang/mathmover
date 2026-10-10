import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../lib/conversation-index.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const { conversationTurns, readingTurnIndex } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const message = (id, role, content = '', attachments) => ({ id, role, content, attachments, createdAt: 1 });

test('only user questions create markers, in stable conversation order', () => {
  const input = [message('system', 'system'), message('user"[]1', 'user', '第一题'), message('a', 'assistant'),
    message('u2', 'user', '第二题'), message('tool', 'assistant', '读取画板')];
  const snapshot = JSON.stringify(input);
  assert.deepEqual(conversationTurns(input).map(t => [t.id, t.number]), [['user"[]1', 1], ['u2', 2]]);
  assert.equal(JSON.stringify(input), snapshot);
});

test('image-only and old empty questions retain a meaningful marker', () => {
  const turns = conversationTurns([message('image', 'user', ' ', [{ unavailable: true }, { url: 'data:image/png;base64,fixture' }]), message('empty', 'user')]);
  assert.equal(turns[0].preview, '题目图片 · 2 张');
  assert.equal(turns[0].images, 2);
  assert.equal(turns[1].preview, '未填写题目文字');
  assert.doesNotMatch(JSON.stringify(turns), /base64|fixture/);
});

test('preview keeps plain math and complete unicode characters without huge payloads', () => {
  const turns = conversationTurns([message('math', 'user', '  求 $x^2$ 的图像  与\n性质 '), message('long', 'user', '😀'.repeat(200))]);
  assert.equal(turns[0].preview, '求 $x^2$ 的图像 与 性质');
  assert.equal(Array.from(turns[1].preview).length, 160);
  assert.equal(turns[1].preview, '😀'.repeat(160));
});

test('reading stays in the question round until the next question reaches the reading line', () => {
  const positions = [20, 500, 1300];
  assert.equal(readingTurnIndex([], 0, 600, 1600), -1);
  assert.equal(readingTurnIndex(positions, 0, 600, 1600), 0);
  assert.equal(readingTurnIndex(positions, 467, 600, 2000), 0);
  assert.equal(readingTurnIndex(positions, 468, 600, 2000), 1);
  assert.equal(readingTurnIndex(positions, 1100, 200, 2000), 1);
  assert.equal(readingTurnIndex(positions, 1268, 200, 2000), 2);
});

test('bottom selects the latest question even when its reply is shorter than a viewport', () => {
  assert.equal(readingTurnIndex([20, 700], 700, 300, 1000), 1);
  assert.equal(readingTurnIndex([20, 100], 0, 600, 400), 0);
});
