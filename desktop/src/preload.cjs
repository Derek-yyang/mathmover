/**
 * 桌面端预加载：只暴露「这是桌面壳 + 几个动作」的最小面。
 *
 * 渲染进程不能直接碰 Electron；所有能力都经 main.cjs 的 ipcMain 处理。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mathmoverDesktop', {
  isDesktop: true,
  /** 检查更新 / 打开日志 / 复制诊断 / 关于 */
  action: (name) => {
    if (typeof name === 'string') ipcRenderer.send('desktop-action', name);
  },
  /** 让原生标题栏按钮与窗口边框跟随应用主题 */
  setTitleBarTheme: (theme) => {
    ipcRenderer.send('set-titlebar-theme', theme === 'dark' ? 'dark' : 'light');
  },
});
