/** Sparkle owns download verification and installation; this controller owns our dialogs and update state. */
function createSparkleUpdater({ loadBridge, config, fallback, showMessageBox, openExternal, log, setState = () => {} }) {
  let bridge;
  let initializing;
  let busy = false;
  let manual = false;
  let readyVersion;
  let downloading = false;
  let lastPercent = -1;
  let progressBucket = -1;

  async function onEvent(event) {
    if (event.type === 'download-progress') {
      const percent = Math.max(0, Math.min(100, Math.round(event.percent || 0)));
      const bucket = Math.floor(percent / 25);
      if (bucket !== progressBucket) {
        progressBucket = bucket;
        log(`Mac 更新 ${event.phase || 'download'}：${percent}%`);
      }
      if (percent !== lastPercent) {
        lastPercent = percent;
        setState({ status: 'downloading', percent });
      }
      return;
    }
    log('Sparkle：', JSON.stringify(event));
    if (event.type === 'update-available') {
      busy = true;
      downloading = true;
      lastPercent = -1;
      setState({ status: 'downloading', percent: 0 });
    } else if (event.type === 'update-downloaded') {
      busy = false;
      manual = false;
      downloading = false;
      readyVersion = event.version || '';
      // 与 Windows 的 autoInstallOnAppQuit 对齐：不点重启也会在退出时安装。
      // 原生驱动要在事件返回后才记录安装指令，延后一拍再发。
      setImmediate(() => {
        try { bridge?.installUpdateOnQuit(); }
        catch (error) { log('Mac 退出时安装更新失败：', error.message); }
      });
      setState({ status: 'ready', version: readyVersion });
    } else if (event.type === 'update-not-available') {
      busy = false;
      downloading = false;
      const notify = manual;
      manual = false;
      if (readyVersion === undefined) setState({ status: 'idle' });
      if (notify) await showMessageBox({ type: 'info', title: '检查更新', message: '当前已是最新版本。' });
    } else if (event.type === 'error') {
      busy = false;
      const notify = manual;
      manual = false;
      // 只是检查失败不打扰；下载或校验中断才变成可重试的状态环。
      if (downloading) setState({ status: 'failed', message: event.message });
      downloading = false;
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
      // 已就绪时标题栏的状态环就是提示，不再弹框。
      if (readyVersion !== undefined) return;
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
    /** 状态环的「立即重启」：只处理已经验证并下载完成的更新。 */
    installNow() {
      if (readyVersion === undefined || !bridge) return;
      try { bridge.installUpdateNow(); }
      catch (error) { log('Mac 安装更新失败：', error.message); }
    },
    dispose() { bridge?.setEventHandler(null); },
  };
}
module.exports = { createSparkleUpdater };
