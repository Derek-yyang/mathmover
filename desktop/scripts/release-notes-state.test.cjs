const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReleaseNotesState } = require('../src/release-notes-state.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mathmover-release-notes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('acknowledgement survives restart; a newer version displays once', t => {
  const dir = fixture(t);
  const old = createReleaseNotesState(dir, '0.0.9');
  old.acknowledge('0.0.9');
  const update = createReleaseNotesState(dir, '0.0.10');
  assert.equal(update.get().shouldShow, true);
  update.acknowledge('0.0.10');
  assert.equal(createReleaseNotesState(dir, '0.0.10').get().shouldShow, false);
  assert.equal(createReleaseNotesState(dir, '0.0.11').get().shouldShow, true);
});

test('first-install onboarding takes priority', t => {
  const state = createReleaseNotesState(fixture(t), '0.0.10');
  assert.equal(state.get(true).shouldShow, false);
  state.acknowledge('0.0.10');
  assert.equal(state.get(false).shouldShow, false);
});

test('downgrading does not prompt or erase a newer acknowledgement', t => {
  const dir = fixture(t);
  createReleaseNotesState(dir, '0.0.10').acknowledge('0.0.10');
  const downgrade = createReleaseNotesState(dir, '0.0.9');
  assert.equal(downgrade.get().shouldShow, false);
  downgrade.acknowledge('0.0.9');
  assert.equal(createReleaseNotesState(dir, '0.0.10').get().seenVersion, '0.0.10');
});

test('corrupt state recovers and unrelated version writes are rejected', t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'release-notes.json'), '{');
  const state = createReleaseNotesState(dir, '0.0.10');
  assert.equal(state.get().shouldShow, true);
  assert.throws(() => state.acknowledge('0.0.11'));
  state.acknowledge('0.0.10');
  assert.equal(state.get().shouldShow, false);
});

test('the shipped version has ordered, unique, user-facing release notes', () => {
  const releases = require('../release-notes.json');
  assert.equal(releases[0].version, require('../package.json').version);
  assert.equal(new Set(releases.map(release => release.version)).size, releases.length);
  for (const [index, release] of releases.entries()) {
    assert.ok(release.items.length > 0);
    for (const item of release.items) {
      assert.ok(['新增', '优化', '修复'].includes(item.kind));
      assert.ok(item.text.trim());
    }
    if (index > 0) assert.ok(releases[index - 1].version.localeCompare(release.version, undefined, { numeric: true }) > 0);
  }
});
