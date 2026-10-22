const { app, Menu, Tray } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/** 托盘只隐藏现有窗口，不重建工作台或中断生成中的任务。 */
function createSystemTray({ window, iconPath, preferencesPath, onCheckUpdates, log }) {
  let tray = null;
  let quitting = false;
  let closeToTray = false;

  try {
    closeToTray = JSON.parse(fs.readFileSync(preferencesPath, 'utf8')).closeToTray === true;
  } catch (error) {
    if (error.code !== 'ENOENT') log('读取桌面设置失败，使用默认值：', error.message);
  }

  const available = () => tray !== null && !tray.isDestroyed();
  const getPreferences = () => ({ closeToTray, trayAvailable: available() });
  const showWindow = () => {
    if (quitting || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };

  const destroy = () => {
    quitting = true;
    if (available()) tray.destroy();
    tray = null;
  };
  const onClose = (event) => {
    // 图标创建失败时仍允许退出，避免留下无法重新打开的后台窗口。
    if (!quitting && closeToTray && available()) {
      event.preventDefault();
      window.hide();
    }
  };

  try {
    tray = new Tray(iconPath);
    tray.setToolTip('MathMover');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 MathMover', click: showWindow },
      { label: '检查更新…', click: () => { showWindow(); void onCheckUpdates(); } },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]));
    // macOS 左键由系统展开菜单；不要同时恢复窗口，避免菜单与焦点抢占。
    if (process.platform !== 'darwin') {
      tray.on('click', showWindow);
      tray.on('double-click', showWindow);
    }
  } catch (error) {
    if (available()) tray.destroy();
    tray = null;
    log('创建系统托盘失败：', error.message);
  }

  window.on('close', onClose);
  // app.quit（包括自动更新）必须真正退出，而不是被关闭到托盘的行为拦截。
  app.on('before-quit', destroy);
  window.on('session-end', destroy);
  window.once('closed', () => {
    destroy();
    app.removeListener('before-quit', destroy);
  });

  return {
    showWindow,
    getPreferences,
    setCloseToTray(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('无效的桌面设置');
      if (enabled && !available()) throw new Error('系统托盘不可用，暂时无法启用此选项');
      fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
      const temporaryPath = `${preferencesPath}.tmp`;
      fs.writeFileSync(temporaryPath, JSON.stringify({ closeToTray: enabled }, null, 2) + '\n');
      fs.renameSync(temporaryPath, preferencesPath);
      closeToTray = enabled;
      return getPreferences();
    },
  };
}

module.exports = { createSystemTray };
