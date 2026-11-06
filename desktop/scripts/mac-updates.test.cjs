const { test } = require('node:test');
const assert = require('node:assert/strict');
const { APPCAST_URL, DOWNLOAD_PAGE_URL, getMacUpdate, createMacUpdater } = require('../src/mac-updates.cjs');

function appcast(version = '0.0.4', overrides = {}) {
  const url = overrides.url || `https://mathmover.top/update/mac/v${version}/MathMover-${version}-mac-arm64.zip`;
  const body = `<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><item><enclosure url="${url}" sparkle:version="${version}" sparkle:shortVersionString="${version}" /></item></channel></rss>`;
  return overrides.body || body;
}
const fetchAppcast = data => async () => ({ ok: true, text: async () => data });
const check = data => getMacUpdate({ currentVersion: '0.0.3', arch: 'arm64', fetchAppcast: fetchAppcast(data) });

test('Mac 从中转 appcast 检查版本，下载地址仍限定为签名 ZIP 对应的官方 DMG', async () => {
  assert.deepEqual(await check(appcast()), { version: '0.0.4',
    url: 'https://mathmover.top/update/mac/v0.0.4/MathMover-0.0.4-mac-arm64.dmg' });
  assert.equal(await check(appcast('0.0.3')), null);
  assert.equal(await check(appcast('0.0.2')), null);
  assert.equal((await getMacUpdate({ currentVersion: '0.0.9', arch: 'arm64', fetchAppcast: fetchAppcast(appcast('0.0.10')) })).version, '0.0.10');
});

test('拒绝缺失 appcast、非法版本和非中转 ZIP 地址', async () => {
  for (const data of [appcast('0.0.4', { body: '<rss><channel><item /></channel></rss>' }),
    appcast('../bad'), appcast('0.0.4', { url: 'https://untrusted.invalid/update.zip' })]) {
    await assert.rejects(check(data));
  }
  await assert.rejects(getMacUpdate({ currentVersion: '0.0.3', arch: 'x64', fetchAppcast: fetchAppcast(appcast()) }));
});

function controller(fetcher, choices = [0]) {
  const dialogs = [], opened = [], logs = [];
  const updater = createMacUpdater({ getVersion: () => '0.0.3', arch: 'arm64', feedUrl: APPCAST_URL, fetchAppcast: fetcher,
    showMessageBox: options => { dialogs.push(options); return choices.shift() ?? 1; },
    openExternal: async url => { opened.push(url); }, log: (...args) => logs.push(args) });
  return { updater, dialogs, opened, logs };
}

test('启动检查有新版时提醒，选择下载打开 DMG；同一版本不重复主动打扰', async () => {
  const { updater, dialogs, opened } = controller(fetchAppcast(appcast()));
  await updater.check({ silent: true });
  await updater.check({ silent: true });
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0].detail, /退出 MathMover/);
  assert.equal(opened.length, 1);
  assert.match(opened[0], /\/update\/mac\/v0.0.4\/MathMover-0.0.4-mac-arm64.dmg$/);
  await updater.check();
  assert.equal(dialogs.length, 2, '手动检查仍可再次查看新版');
});

test('无新版或断网时启动检查保持安静；手动检查有明确结果和下载页退路', async () => {
  const latest = controller(fetchAppcast(appcast('0.0.3')));
  await latest.updater.check({ silent: true });
  assert.equal(latest.dialogs.length, 0);
  await latest.updater.check();
  assert.match(latest.dialogs[0].message, /最新版本/);
  const offline = controller(async () => { throw new Error('offline'); });
  await offline.updater.check({ silent: true });
  assert.equal(offline.dialogs.length, 0);
  await offline.updater.check();
  assert.match(offline.dialogs[0].message, /无法检查/);
  assert.deepEqual(offline.opened, [DOWNLOAD_PAGE_URL]);
});

test('重复点击不会并发请求；稍后不会开始下载', async () => {
  let finish, calls = 0;
  const { updater, dialogs, opened } = controller(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, [1]);
  const first = updater.check();
  const second = updater.check();
  assert.equal(calls, 1);
  finish({ ok: true, text: async () => appcast() });
  await Promise.all([first, second]);
  assert.equal(dialogs.length, 1);
  assert.equal(opened.length, 0);
});

test('中转 appcast 访问失败时作为检查失败处理，不误报已经是最新版', async () => {
  await assert.rejects(getMacUpdate({ currentVersion: '0.0.3', arch: 'arm64',
    fetchAppcast: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
});
