import type { WebSocket } from 'ws';
import type { RawState } from '../../packages/ggb-core/src/types.ts';

/** One authenticated canvas connection, owned by one product session. */
export class CanvasBridge {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  snapshot: RawState | null = null;

  get connected() { return this.socket?.readyState === 1; }

  attach(socket: WebSocket) {
    if (this.connected) {
      // A host may open the delivery preview after its generation panel.
      // Hand control to the new view; the retired view must not retry.
      this.rejectPending('画板已切换到新页面，请重新读取状态后继续。');
      this.socket!.close(4001, '画板已在另一页面打开');
    }
    this.socket = socket;
    socket.on('message', data => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(String(message.error)));
      else {
        const state = message.payload?.state ?? message.payload;
        if (state?.objects && state?.commands) this.snapshot = state;
        pending.resolve(message.payload);
      }
    });
    socket.once('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.rejectPending('GGB_SESSION_DEAD: 画板已断开，请在宿主浏览器重新打开此会话地址。');
    });
    socket.on('error', () => {});
  }

  call<T>(op: string, args?: unknown, timeoutMs = 20000): Promise<T> {
    if (!this.connected) return Promise.reject(new Error('GGB_SESSION_DEAD: 请先在宿主内置浏览器中打开会话画板，等待连接就绪。'));
    const id = String(++this.sequence);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`画板请求超时：${op}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.socket!.send(JSON.stringify({ id, op, args }), error => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  close() {
    this.rejectPending('MathMover 本地画板服务已关闭');
    this.socket?.terminate();
    this.socket = null;
  }

  private rejectPending(message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }
}
