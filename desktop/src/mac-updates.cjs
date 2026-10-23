// macOS 免费分发：只检查正式 Releases，引导用户下载 DMG，不替换正在运行的应用。
const RELEASES_URL = 'https://github.com/Derek-yyang/mathmover/releases/latest';
const API_URL = 'https://api.github.com/repos/Derek-yyang/mathmover/releases/latest';

function stableVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value || '');
  if (!match) throw new Error('更新服务返回了无效的正式版本号');
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('版本号超出范围');
  return parts;
}

async function getMacUpdate({ currentVersion, arch, fetchRelease }) {
  const response = await fetchRelease(API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MathMover-Desktop' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`更新服务暂不可用（HTTP ${response.status}）`);
  const release = await response.json();
  if (release.draft || release.prerelease) throw new Error('更新服务返回了非正式版本');
  const latest = stableVersion(release.tag_name);
  const current = stableVersion(currentVersion);
  const difference = latest.map((part, index) => part - current[index]).find(part => part !== 0) || 0;
  if (difference <= 0) return null;
  const version = latest.join('.');
  const filename = `MathMover-${version}-mac-${arch}.dmg`;
  const asset = release.assets?.find(item => item.name === filename && item.state === 'uploaded' && item.size > 0);
  if (!asset) throw new Error('新版本尚未提供适用于这台 Mac 的安装包，请稍后再试');
  // 不信任远端提供的跳转 URL；仅打开本仓库中已确认存在的版本化安装包。
  return { version, url: `https://github.com/Derek-yyang/mathmover/releases/download/${release.tag_name}/${filename}` };
}

function createMacUpdater({ getVersion, arch, fetchRelease, showMessageBox, openExternal, log }) {
  let checking = null;
  let notifiedVersion = null;
  return {
    check({ silent = false } = {}) {
      if (checking) return checking;
      checking = (async () => {
        try {
          const update = await getMacUpdate({ currentVersion: getVersion(), arch, fetchRelease });
          if (!update) {
            if (!silent) showMessageBox({
              type: 'info', title: '检查更新', message: '当前已是最新版本。', detail: `版本 ${getVersion()}`,
            });
            return;
          }
          if (silent && notifiedVersion === update.version) return;
          notifiedVersion = update.version;
          const choice = showMessageBox({
            type: 'info', title: '发现新版本', message: `MathMover ${update.version} 可以下载了`,
            detail: `当前版本 ${getVersion()}。下载后退出 MathMover，把新版拖到「应用程序」并替换旧版。课件和设置保留在本机。`,
            buttons: ['下载新版', '稍后'], defaultId: 0, cancelId: 1,
          });
          if (choice === 0) await openExternal(update.url);
        } catch (error) {
          log('Mac 更新检查失败：', error instanceof Error ? error.message : error);
          if (!silent) {
            const choice = showMessageBox({
              type: 'warning', title: '检查更新失败', message: '暂时无法检查新版。',
              detail: '请检查网络连接，或前往 GitHub Releases 手动查看并下载适用于 Apple 芯片的 DMG。',
              buttons: ['打开下载页', '稍后'], defaultId: 0, cancelId: 1,
            });
            if (choice === 0) await openExternal(RELEASES_URL).catch(error => log('打开下载页失败：', error.message));
          }
        } finally {
          checking = null;
        }
      })();
      return checking;
    },
  };
}

module.exports = { getMacUpdate, createMacUpdater };
