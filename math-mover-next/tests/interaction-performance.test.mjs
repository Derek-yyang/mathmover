import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

async function load(file) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
const { createStreamTextBatch } = await load('../lib/stream-text-batch.ts');
const { createLiveResize } = await load('../lib/live-resize.ts');

test('fast deltas update together, preserving text order and Unicode', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const output = [];
  const batch = createStreamTextBatch(text => output.push(text));
  batch.push('函数 $'); t.mock.timers.tick(20);
  batch.push('x^2$ 😀'); t.mock.timers.tick(19);
  assert.deepEqual(output, []);
  t.mock.timers.tick(1);
  assert.deepEqual(output, ['函数 $x^2$ 😀']);
  batch.push('\n下一段'); t.mock.timers.tick(40);
  assert.equal(output.join(''), '函数 $x^2$ 😀\n下一段');
});

test('tool, error, stop and final flushes retain the last partial batch exactly once', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const output = [];
  const batch = createStreamTextBatch(text => output.push(text));
  batch.push('停止前的内容');
  batch.flush(); batch.flush(); t.mock.timers.tick(100);
  assert.deepEqual(output, ['停止前的内容']);
  batch.push('下一段'); batch.flush(); t.mock.timers.tick(100);
  assert.deepEqual(output, ['停止前的内容', '下一段']);
});

function frameClock() {
  let next = 0;
  const callbacks = new Map();
  return {
    request(callback) { callbacks.set(++next, callback); return next; },
    cancel(id) { callbacks.delete(id); },
    tick(time) {
      const batch = [...callbacks.values()]; callbacks.clear();
      batch.forEach(callback => callback(time));
    },
    get pending() { return callbacks.size; },
  };
}

test('continuous boundary changes follow during motion and apply the final size', () => {
  const clock = frameClock(), output = [];
  let width = 100;
  const resize = createLiveResize(() => output.push(width), 32, clock);
  for (let frame = 1; frame <= 30; frame++) {
    width = 100 + frame;
    resize.schedule(); resize.schedule();
    assert.equal(clock.pending, 1);
    clock.tick(frame * 16);
  }
  assert.equal(output.length, 15);
  assert.equal(output[0], 101);
  assert.equal(output.at(-1), 129);
  clock.tick(496);
  assert.equal(output.at(-1), 130);
  assert.equal(clock.pending, 0);
  clock.tick(1000);
  assert.equal(output.length, 16);
});

test('unmount cancels pending resize and later changes can schedule again', () => {
  const clock = frameClock();
  let calls = 0;
  const resize = createLiveResize(() => calls++, 32, clock);
  resize.schedule(); resize.cancel(); clock.tick(100);
  assert.equal(calls, 0);
  resize.schedule(); clock.tick(116);
  assert.equal(calls, 1);
});

test('expensive applet redraw leaves time for input and keeps the latest size', () => {
  const clock = frameClock();
  let now = 0, width = 100;
  const sizes = [];
  const resize = createLiveResize(() => { sizes.push(width); now += 90; }, 32, { ...clock, now: () => now });
  resize.schedule(); clock.tick(0);
  assert.deepEqual(sizes, [100]);
  width = 120; resize.schedule(); now = 100; clock.tick(100);
  width = 140; resize.schedule(); now = 160; clock.tick(160);
  assert.deepEqual(sizes, [100]);
  now = 180; clock.tick(180);
  assert.deepEqual(sizes, [100]);
  now = 270; clock.tick(270);
  assert.deepEqual(sizes, [100, 140]);
  assert.equal(clock.pending, 0);
});
