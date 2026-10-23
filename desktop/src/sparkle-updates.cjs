/** Sparkle owns download verification and installation; this controller owns our dialogs. */
function createSparkleUpdater({ loadBridge, config, fallback, showMessageBox, openExternal, log }) {
  let bridge;
  let initializing;
  let busy = false;
  let manual = false;
  let readyVersion;
  let prompting = false;
  let progressBucket = -1;

  async function showReady() {
    if (prompting) return;
    prompting = true;
    try {
      const choice = await showMessageBox({
        type: 'info', title: '更新已就绪', message: `MathMover ${readyVersion} 已下载`,
        detail: '更新包已验证。请先结束当前生成任务，再重启更新；课件和设置会保留。选择「稍后」会在退出应用时安装。',
        buttons: ['重启更新', '稍后'], defaultId: 0, cancelId: 1,
      });
      if (choice === 0) bridge.installUpdateNow();
      else bridge.installUpdateOnQuit();
    } catch (error) { log('Mac 安装更新失败：', error.message); }
    finally { prompting = false; }
  }

  async function onEvent(event) {
    if (event.type === 'download-progress') {
      const bucket = Math.floor((event.percent || 0) / 25);
      if (bucket !== progressBucket) {
        progressBucket = bucket;
        log(`Mac 更新 ${event.phase || 'download'}：${Math.round(event.percent || 0)}%`);
      }
      return;
    }
    log('Sparkle：', JSON.stringify(event));
    if (event.type === 'update-available') busy = true;
    else if (event.type === 'update-downloaded') {
      busy = false;
      manual = false;
      readyVersion = event.version || '';
      // Native driver stores its install reply after returning from this event.
      setImmediate(() => { void showReady(); });
    } else if (event.type === 'update-not-available') {
      busy = false;
      const notify = manual;
      manual = false;
      if (notify) await showMessageBox({ type: 'info', title: '检查更新', message: '当前已是最新版本。' });
    } else if (event.type === 'error') {
      busy = false;
      const notify = manual;
      manual = false;
      if (notify) {
        const choice = await showMessageBox({
          type: 'warning', title: '更新暂不可用', message: '无法完成更新，请稍后重试。',
          detail: '可以检查网络连接，或从 GitHub Releases 手动下载安装。',
          buttons: ['打开下载页', '稍后'], defaultId: 1, cancelId: 1,
        });
        if (choice === 0) await openExternal('https://github.com/Derek-yyang/mathmover/releases/latest');
      }
    }
  }

  async function init() {
    if (!initializing) initializing = (async () => {
      try {
        const loaded = await loadBridge();
        if (!loaded) return;
        loaded.setEventHandler(event => { void onEvent(event).catch(error => log('Mac 更新提示失败：', error.message)); });
        if (!loaded.init({ appcastUrl: config.feedUrl, publicEdKey: config.publicEdKey })) {
          loaded.setEventHandler(null);
          throw new Error('Sparkle initialization failed');
        }
        bridge = loaded;
        bridge.setAutomaticChecks(true);
        log('Sparkle 自动更新已就绪');
      } catch (error) {
        log('Sparkle 不可用，保留手动下载：', error.message);
        bridge = null;
      }
    })();
    await initializing;
    return Boolean(bridge);
  }

  return {
    init,
    async check({ silent = false } = {}) {
      await init();
      if (!bridge) return fallback.check({ silent });
      if (readyVersion !== undefined) { if (!silent) await showReady(); return; }
      manual ||= !silent;
      if (busy) {
        if (!silent) await showMessageBox({ type: 'info', title: '检查更新', message: '正在检查或准备更新，完成后会提示重启。' });
        return;
      }
      busy = true;
      progressBucket = -1;
      try { bridge.checkForUpdates(); }
      catch (error) { await onEvent({ type: 'error', message: error.message }); }
    },
    dispose() { bridge?.setEventHandler(null); },
  };
}
module.exports = { createSparkleUpdater };
