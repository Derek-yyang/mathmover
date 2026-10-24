const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUpdateLog } = require('../src/update-log.cjs');

function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-updlog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'updater.log');
}

test('appends timestamped lines with strings and JSON values', t => {
  const file = tempFile(t);
  const log = createUpdateLog(file, { now: () => new Date('2026-10-24T08:00:00Z') });
  log('检查更新（手动）');
  log('Sparkle：', { type: 'error', message: 'TLS reset' });
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines[0], '[2026-10-24T08:00:00.000Z] 检查更新（手动）');
  assert.equal(lines[1], '[2026-10-24T08:00:00.000Z] Sparkle： {"type":"error","message":"TLS reset"}');
});

test('rotates once the file grows past the cap', t => {
  const file = tempFile(t);
  const log = createUpdateLog(file, { maxBytes: 20, now: () => new Date('2026-10-24T08:00:00Z') });
  log('first');
  log('second');
  const rotated = fs.readFileSync(`${file}.1`, 'utf8');
  const current = fs.readFileSync(file, 'utf8');
  assert.match(rotated, /first/);
  assert.match(current, /second/);
  assert.doesNotMatch(current, /first/);
});

test('never throws when the target cannot be written', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-updlog-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = createUpdateLog(dir); // 目录当文件：写入必然失败
  assert.doesNotThrow(() => log('still fine'));
});
