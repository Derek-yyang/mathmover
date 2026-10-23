const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSparkleUpdater } = require('../src/sparkle-updates.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ available = true, choice = 0 } = {}) {
  const calls = []; let handler;
  const bridge = {
    init: () => true, setAutomaticChecks: value => calls.push(['automatic', value]),
    setEventHandler: value => { handler = value; }, checkForUpdates: () => calls.push(['check']),
    installUpdateNow: () => calls.push(['install']), installUpdateOnQuit: () => calls.push(['later']),
  };
  const controller = createSparkleUpdater({
    loadBridge: async () => available ? bridge : null, config: {},
    fallback: { check: options => calls.push(['fallback', options.silent]) },
    showMessageBox: async options => { calls.push(['dialog', options.title]); return choice; },
    openExternal: url => calls.push(['url', url]), log: () => {},
  });
  return { controller, calls, event: async event => { handler(event); await tick(); await tick(); } };
}
test('one check at a time, automatic checks stay quiet when current', async () => {
  const f = fixture(); await f.controller.check({ silent: true }); await f.controller.check({ silent: true });
  assert.equal(f.calls.filter(c => c[0] === 'check').length, 1);
  await f.event({ type: 'update-not-available' }); assert(!f.calls.some(c => c[0] === 'dialog'));
  await f.controller.check(); await f.event({ type: 'update-not-available' });
  assert(f.calls.some(c => c[1] === '检查更新'));
});
test('only verified ready event offers installation, manual check can reopen it', async () => {
  const f = fixture(); await f.controller.check();
  await f.event({ type: 'update-available', version: '0.0.6' });
  await f.event({ type: 'download-progress', percent: 100 });
  assert(!f.calls.some(c => c[0] === 'install'));
  await f.event({ type: 'update-downloaded', version: '0.0.6' });
  assert.equal(f.calls.filter(c => c[0] === 'install').length, 1);
});
test('later stages installation on quit and manual check offers ready update again', async () => {
  const f = fixture({ choice: 1 }); await f.controller.init();
  await f.event({ type: 'update-downloaded', version: '0.0.6' });
  assert(f.calls.some(c => c[0] === 'later')); assert(!f.calls.some(c => c[0] === 'install'));
  await f.controller.check(); assert.equal(f.calls.filter(c => c[0] === 'later').length, 2);
  f.controller.dispose();
});
test('failed bridge falls back; verification error never installs and can retry', async () => {
  const missing = fixture({ available: false }); await missing.controller.check();
  assert.deepEqual(missing.calls, [['fallback', false]]);
  const f = fixture(); await f.controller.check({ silent: true });
  await f.event({ type: 'error', message: 'signature mismatch' });
  assert(!f.calls.some(c => c[0] === 'dialog' || c[0] === 'install'));
  await f.controller.check(); assert.equal(f.calls.filter(c => c[0] === 'check').length, 2);
});
test('packaging and runtime use the same trust root and require signed feed', () => {
  const fs = require('node:fs'); const config = require('../src/sparkle-config.json');
  const yaml = fs.readFileSync(require('node:path').join(__dirname, '../electron-builder.yml'), 'utf8');
  assert(yaml.includes(`SUPublicEDKey: ${config.publicEdKey}`));
  assert(yaml.includes(`SUFeedURL: ${config.feedUrl}`));
  assert(yaml.includes('SURequireSignedFeed: true')); assert(yaml.includes('SUVerifyUpdateBeforeExtraction: true'));
});
