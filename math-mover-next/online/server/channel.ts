import { randomUUID } from 'node:crypto';
import type { RawState } from '@mathmover/ggb-core';

export interface Socket {
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
}

/** One channel per connection, never a module-global session map. Reconnects may reach another instance. */
export class CanvasChannel {
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private live = true;
  readonly socket: Socket;
  constructor(socket: Socket) { this.socket = socket; }
  get connected() { return this.live && this.socket.readyState === 1; }
  get snapshot(): RawState | null { return null; }
  send(message: unknown) { if (this.connected) this.socket.send(JSON.stringify(message)); }
  call<T>(op: string, args?: unknown, timeout = 20000): Promise<T> {
    if (!this.connected) return Promise.reject(new Error('画板连接已断开。'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // Keep the same timeout contract as the local daemon. GgbTools only
        // degrades a timed-out apply when it can recognize this prefix.
        reject(new Error(`GGB_CALL_TIMEOUT: 画板 ${op} 超过 ${timeout}ms 未返回（结果可能已生效但未确认）`));
      }, timeout);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      this.send({ type: 'canvas', id, op, args });
    });
  }
  receive(message: { type?: string; id?: string; payload?: unknown; error?: string }) {
    if (message.type !== 'canvas-result' || !message.id) return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.payload);
  }
  dispose() {
    this.live = false;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('画板连接已断开。')); }
    this.pending.clear();
  }
}
