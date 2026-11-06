// macOS fallback for builds where the native Sparkle bridge is unavailable.
// The appcast and all release assets are served by the MathMover Pages relay.
const APPCAST_URL = 'https://mathmover.top/update/mac/appcast-mac-arm64.xml';
const DOWNLOAD_PAGE_URL = 'https://mathmover.top/download/mac';

function stableVersion(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value || '');
  if (!match) throw new Error('更新服务返回了无效的正式版本号');
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('版本号超出范围');
  return parts;
}

function xmlAttribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attributes);
  return match?.[1] ?? match?.[2] ?? null;
}

function xmlTagText(xml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escaped}\\b[^>]*>([^<]*)<\\/${escaped}\\s*>`, 'i').exec(xml);
  return match?.[1]?.trim() || null;
}

function versionedArchiveUrl(version) {
  return `https://mathmover.top/update/mac/v${version}/MathMover-${version}-mac-arm64.zip`;
}

async function getMacUpdate({ currentVersion, arch, feedUrl = APPCAST_URL, fetchAppcast }) {
  if (arch !== 'arm64') throw new Error('当前只提供 Apple 芯片版更新');
  const response = await fetchAppcast(feedUrl, {
    headers: { 'User-Agent': 'MathMover-Desktop' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`更新服务暂不可用（HTTP ${response.status}）`);

  const appcast = await response.text();
  const item = /<item\b[^>]*>([\s\S]*?)<\/item\s*>/i.exec(appcast)?.[1];
  const enclosure = /<enclosure\b([^>]*?)\/?\s*>/i.exec(item || '')?.[1];
  if (!item || !enclosure) throw new Error('更新服务没有提供可用的 Mac 更新包');

  const rawVersion = xmlAttribute(enclosure, 'sparkle:version')
    || xmlTagText(item, 'sparkle:version')
    || xmlAttribute(enclosure, 'sparkle:shortVersionString')
    || xmlTagText(item, 'sparkle:shortVersionString');
  const latest = stableVersion(rawVersion);
  const current = stableVersion(currentVersion);
  const difference = latest.map((part, index) => part - current[index]).find(part => part !== 0) || 0;
  if (difference <= 0) return null;

  const version = latest.join('.');
  const archiveUrl = xmlAttribute(enclosure, 'url');
  if (archiveUrl !== versionedArchiveUrl(version)) {
    throw new Error('更新服务返回的 Mac 更新包地址无效');
  }

  return {
    version,
    url: `https://mathmover.top/update/mac/v${version}/MathMover-${version}-mac-arm64.dmg`,
  };
}

function createMacUpdater({ getVersion, arch, feedUrl = APPCAST_URL, fetchAppcast, showMessageBox, openExternal, log }) {
  let checking = null;
  let notifiedVersion = null;
  return {
    check({ silent = false } = {}) {
      if (checking) return checking;
      checking = (async () => {
        try {
          const update = await getMacUpdate({ currentVersion: getVersion(), arch, feedUrl, fetchAppcast });
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
              detail: '请检查网络连接，或前往 MathMover 官网下载适用于 Apple 芯片的安装包。',
              buttons: ['打开下载页', '稍后'], defaultId: 0, cancelId: 1,
            });
            if (choice === 0) await openExternal(DOWNLOAD_PAGE_URL).catch(error => log('打开下载页失败：', error.message));
          }
        } finally {
          checking = null;
        }
      })();
      return checking;
    },
  };
}

module.exports = { APPCAST_URL, DOWNLOAD_PAGE_URL, getMacUpdate, createMacUpdater };
