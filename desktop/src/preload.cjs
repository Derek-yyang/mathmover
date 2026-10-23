/**
 * 桌面端预加载：只暴露「这是桌面壳 + 几个动作」的最小面。
 *
 * 渲染进程不能直接碰 Electron；所有能力都经 main.cjs 的 ipcMain 处理。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mathmoverDesktop', {
  isDesktop: true,
  getPreferences: () => ipcRenderer.invoke('desktop-preferences:get'),
  setCloseToTray: (enabled) => ipcRenderer.invoke('desktop-preferences:set-close-to-tray', enabled),
  /** 检查更新 / 重启更新 / 重试 / 打开日志 / 复制诊断 / 关于 */
  action: (name) => {
    if (typeof name === 'string') ipcRenderer.send('desktop-action', name);
  },
  /** 当前更新状态（idle / downloading / ready / failed） */
  getUpdateState: () => ipcRenderer.invoke('update-state:get'),
  /** 订阅更新状态变化；返回取消订阅函数 */
  onUpdateState: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('update-state', handler);
    return () => ipcRenderer.removeListener('update-state', handler);
  },
  /** 让原生标题栏按钮与窗口边框跟随应用主题 */
  setTitleBarTheme: (theme) => {
    ipcRenderer.send('set-titlebar-theme', theme === 'dark' ? 'dark' : 'light');
  },
  /** 模态打开/关闭时让原生按钮区一起压暗（网页遮罩盖不到原生图层） */
  setTitleBarModal: (open, overlay) => {
    ipcRenderer.send('titlebar-modal', Boolean(open), overlay || null);
  },
});
