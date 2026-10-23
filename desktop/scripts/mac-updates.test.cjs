const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getMacUpdate, createMacUpdater } = require('../src/mac-updates.cjs');

function release(version = '0.0.4', overrides = {}) {
  return { tag_name: `v${version}`, draft: false, prerelease: false,
    assets: [{ name: `MathMover-${version}-mac-arm64.dmg`, state: 'uploaded', size: 100,
      browser_download_url: 'https://untrusted.invalid/installer' }], ...overrides };
}
const fetchRelease = data => async () => ({ ok: true, json: async () => data });
const check = data => getMacUpdate({ currentVersion: '0.0.3', arch: 'arm64', fetchRelease: fetchRelease(data) });

test('Mac 只下载本仓库中适合当前架构的正式 DMG，比较版本而非字符串', async () => {
  assert.deepEqual(await check(release()), { version: '0.0.4',
    url: 'https://github.com/Derek-yyang/mathmover/releases/download/v0.0.4/MathMover-0.0.4-mac-arm64.dmg' });
  assert.equal(await check(release('0.0.3')), null);
  assert.equal(await check(release('0.0.2')), null);
  assert.equal((await getMacUpdate({ currentVersion: '0.0.9', arch: 'arm64', fetchRelease: fetchRelease(release('0.0.10')) })).version, '0.0.10');
});

test('拒绝未上传、无适配包、草稿、预发布和非法版本', async () => {
  for (const data of [release('0.0.4', { assets: [] }), release('0.0.4', { draft: true }),
    release('0.0.4', { prerelease: true }), release('../bad'),
    release('0.0.4', { assets: [{ name: 'MathMover-0.0.4-mac-arm64.dmg', state: 'new', size: 100 }] })]) {
    await assert.rejects(check(data));
  }
  await assert.rejects(getMacUpdate({ currentVersion: '0.0.3', arch: 'x64', fetchRelease: fetchRelease(release()) }));
});

function controller(fetcher, choices = [0]) {
  const dialogs = [], opened = [], logs = [];
  const updater = createMacUpdater({ getVersion: () => '0.0.3', arch: 'arm64', fetchRelease: fetcher,
    showMessageBox: options => { dialogs.push(options); return choices.shift() ?? 1; },
    openExternal: async url => { opened.push(url); }, log: (...args) => logs.push(args) });
  return { updater, dialogs, opened, logs };
}

test('启动检查有新版时提醒，选择下载打开 DMG；同一版本不重复主动打扰', async () => {
  const { updater, dialogs, opened } = controller(fetchRelease(release()));
  await updater.check({ silent: true });
  await updater.check({ silent: true });
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0].detail, /退出 MathMover/);
  assert.equal(opened.length, 1);
  assert.match(opened[0], /\/v0.0.4\/MathMover-0.0.4-mac-arm64.dmg$/);
  await updater.check();
  assert.equal(dialogs.length, 2, '手动检查仍可再次查看新版');
});

test('无新版或断网时启动检查保持安静；手动检查有明确结果和下载页退路', async () => {
  const latest = controller(fetchRelease(release('0.0.3')));
  await latest.updater.check({ silent: true });
  assert.equal(latest.dialogs.length, 0);
  await latest.updater.check();
  assert.match(latest.dialogs[0].message, /最新版本/);
  const offline = controller(async () => { throw new Error('offline'); });
  await offline.updater.check({ silent: true });
  assert.equal(offline.dialogs.length, 0);
  await offline.updater.check();
  assert.match(offline.dialogs[0].message, /无法检查/);
  assert.deepEqual(offline.opened, ['https://github.com/Derek-yyang/mathmover/releases/latest']);
});

test('重复点击不会并发请求；稍后不会开始下载', async () => {
  let finish, calls = 0;
  const { updater, dialogs, opened } = controller(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, [1]);
  const first = updater.check();
  const second = updater.check();
  assert.equal(calls, 1);
  finish({ ok: true, json: async () => release() });
  await Promise.all([first, second]);
  assert.equal(dialogs.length, 1);
  assert.equal(opened.length, 0);
});

test('更新 API 被限流时作为检查失败处理，不误报已经是最新版', async () => {
  await assert.rejects(getMacUpdate({ currentVersion: '0.0.3', arch: 'arm64',
    fetchRelease: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
});
