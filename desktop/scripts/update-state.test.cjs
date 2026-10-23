const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateState } = require('../src/update-state.cjs');

function fixture() {
  const sent = [];
  const state = createUpdateState({ send: next => sent.push(next) });
  return { state, sent };
}

test('available starts a downloading state, progress reports whole percents', () => {
  const { state, sent } = fixture();
  state.handle({ type: 'update-available', version: '0.0.6' });
  assert.deepEqual(state.get(), { status: 'downloading', version: '0.0.6', percent: 0 });
  state.handle({ type: 'download-progress', percent: 42.4 });
  assert.deepEqual(state.get(), { status: 'downloading', version: '0.0.6', percent: 42 });
  // 同一整数百分比不重复推送，避免渲染进程跟着高频事件重绘
  const count = sent.length;
  state.handle({ type: 'download-progress', percent: 42.2 });
  assert.equal(sent.length, count);
  state.handle({ type: 'download-progress', percent: 42.6 });
  assert.equal(state.get().percent, 43);
});

test('downloaded becomes ready and is not cleared by a later not-available', () => {
  const { state } = fixture();
  state.handle({ type: 'update-available', version: '0.0.6' });
  state.handle({ type: 'update-downloaded', version: '0.0.6' });
  assert.deepEqual(state.get(), { status: 'ready', version: '0.0.6' });
  state.handle({ type: 'update-not-available' });
  assert.equal(state.get().status, 'ready');
});

test('check failures stay quiet; download failures become retryable', () => {
  const { state } = fixture();
  state.handle({ type: 'error', message: 'offline' });
  assert.equal(state.get().status, 'idle');
  state.handle({ type: 'update-available', version: '0.0.6' });
  state.handle({ type: 'error', message: 'network' });
  assert.deepEqual(state.get(), { status: 'failed', message: 'network' });
});

test('not-available returns a stale downloading state to idle', () => {
  const { state } = fixture();
  state.handle({ type: 'update-available', version: '0.0.6' });
  state.handle({ type: 'update-not-available' });
  assert.deepEqual(state.get(), { status: 'idle' });
});

test('explicit set bypasses event mapping (used by the Sparkle backend)', () => {
  const { state, sent } = fixture();
  state.set({ status: 'downloading', percent: 50 });
  assert.deepEqual(sent.at(-1), { status: 'downloading', percent: 50 });
});
