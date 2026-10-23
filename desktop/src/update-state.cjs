/**
 * 更新状态机：electron-updater 事件 → 标题栏状态环要的形状。
 *
 * 主进程是唯一事实来源；这里只管"事件进来、状态出去"，不碰窗口与 IPC，
 * 便于单测（见 scripts/update-state.test.cjs）。
 */
function createUpdateState({ send = () => {} } = {}) {
  let state = { status: 'idle' };
  let percent = -1;

  function set(next) {
    state = next;
    send(next);
  }

  return {
    get: () => state,
    set,
    handle(event) {
      switch (event.type) {
        case 'update-available':
          percent = -1;
          set({ status: 'downloading', version: event.version, percent: 0 });
          break;
        case 'download-progress': {
          const value = Math.max(0, Math.min(100, Math.round(event.percent || 0)));
          if (value === percent) return;
          percent = value;
          const version = state.status === 'downloading' ? state.version : event.version;
          set({ status: 'downloading', version, percent: value });
          break;
        }
        case 'update-downloaded':
          set({ status: 'ready', version: event.version || '' });
          break;
        case 'update-not-available':
          if (state.status !== 'ready') set({ status: 'idle' });
          break;
        case 'error':
          // 检查阶段失败不打扰（离线很常见）；下载或校验中断才需要重试入口。
          if (state.status === 'downloading') set({ status: 'failed', message: event.message });
          break;
        default:
          break;
      }
    },
  };
}

module.exports = { createUpdateState };
