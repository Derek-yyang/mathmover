/** 使用真实 Electron 窗口和托盘验证生命周期，不启动 daemon 或修改用户数据。
 * 跑法：node desktop/scripts/verify-tray.cjs
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  const timeout = setTimeout(() => {
    console.error('Tray verification timed out');
    child.kill();
    process.exitCode = 1;
  }, 30_000);
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1; });
  child.on('exit', code => { clearTimeout(timeout); process.exitCode = code ?? 1; });
} else {
  const assert = require('node:assert/strict');
  const { once } = require('node:events');
  const { app, BrowserWindow } = require('electron');
  const { createSystemTray } = require('../src/system-tray.cjs');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mathmover-tray-'));
  app.setPath('userData', path.join(temp, 'profile'));
  app.on('window-all-closed', () => {});
  const preferencesPath = path.join(temp, 'desktop-settings.json');
  const iconPath = path.resolve(__dirname, '..', 'build-resources', 'icon.ico');
  const make = (options = {}) => {
    const window = new BrowserWindow({ width: 480, height: 320, show: false });
    const controller = createSystemTray({
      window, preferencesPath, iconPath, onCheckUpdates: () => {}, log: () => {}, ...options,
    });
    return { window, controller };
  };
  app.whenReady().then(async () => {
    const first = make();
    assert.deepEqual(first.controller.getPreferences(), { closeToTray: false, trayAvailable: true });
    const firstClosed = once(first.window, 'closed');
    first.window.close();
    await firstClosed;
    assert(first.window.isDestroyed(), '默认关闭窗口应销毁窗口');

    const second = make();
    second.controller.showWindow();
    const contentsId = second.window.webContents.id;
    second.controller.setCloseToTray(true);
    second.window.close();
    assert(!second.window.isDestroyed(), '开启后关闭窗口应保留工作台');
    assert(!second.window.isVisible(), '开启后关闭窗口应隐藏工作台');
    second.controller.showWindow();
    assert(second.window.isVisible(), '托盘恢复应显示窗口');
    assert.equal(second.window.webContents.id, contentsId, '恢复不能重建工作台');
    second.window.destroy();

    const third = make();
    assert.equal(third.controller.getPreferences().closeToTray, true, '重启应保留设置');
    assert.throws(() => third.controller.setCloseToTray('yes'), /无效/);
    third.window.destroy();

    const missingIcon = make({ iconPath: path.join(temp, 'missing.ico') });
    assert.equal(missingIcon.controller.getPreferences().trayAvailable, false);
    assert.throws(() => missingIcon.controller.setCloseToTray(true), /不可用/);
    const missingClosed = once(missingIcon.window, 'closed');
    missingIcon.window.close();
    await missingClosed;
    assert(missingIcon.window.isDestroyed(), '托盘失败不能把应用留在后台');

    fs.writeFileSync(preferencesPath, '{broken');
    const corrupted = make();
    assert.equal(corrupted.controller.getPreferences().closeToTray, false);
    corrupted.window.destroy();

    const blockedPath = path.join(temp, 'not-a-file');
    fs.mkdirSync(blockedPath);
    const failedSave = make({ preferencesPath: blockedPath });
    assert.throws(() => failedSave.controller.setCloseToTray(true));
    assert.equal(failedSave.controller.getPreferences().closeToTray, false, '保存失败不能改变内存设置');
    failedSave.window.destroy();

    const last = make();
    last.controller.setCloseToTray(true);
    last.window.close();
    app.once('will-quit', () => {
      assert(last.window.isDestroyed(), '显式退出必须绕过关闭到托盘');
      assert.equal(last.controller.getPreferences().trayAvailable, false, '退出后必须销毁托盘');
      console.log('PASS: default close, hide/restore, persistence, invalid settings, tray failure, failed save, explicit quit');
    });
    app.quit();
  }).catch(error => { console.error(error); app.exit(1); });
}
