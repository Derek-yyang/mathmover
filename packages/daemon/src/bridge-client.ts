/**
 * 桥接客户端 —— 监听网页侧的 WebSocket 连接，代为转发工具调用。
 *
 * 为什么是「网页连过来」而不是「daemon 连网页」：
 * 浏览器页面无法当 HTTP/WS 服务端，所以由页面主动连到 127.0.0.1 上的 daemon。
 * 这也是 OpenDesign 的安全姿态：服务只绑回环地址，页面无对外暴露面。
 *
 * 连接生命周期：页面断开后保留最近一次状态快照（供 agent 读到「上一次看到的」），
 * 但工具调用会明确报错，不假装画布还在。
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { RawApplyResult, RawState } from './types.ts';
import { randomBytes } from 'node:crypto';

export interface Pending {
  socket: WebSocket;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class GgbBridgeClient {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  /** 所有存活的页面连接。`socket` 是其中的"活跃画布"，其余是备胎。 */
  private live = new Set<WebSocket>();
  private windows = new Map<string, WebSocket>();
  private tickets = new Map<string, { token: string; expires: number }>();
  private states = new Map<string, RawState>();
  private pending = new Map<string, Pending>();
  private seq = 0;
  private lastState: RawState | null = null;
  private listeners = new Set<(connected: boolean) => void>();
  private readonly opts: {
    port: number;
    host?: string;
    callTimeoutMs?: number;
  };

  // 注意：不用构造函数参数属性——Node 的 TS 类型剥离不支持该语法（需完整编译）。
  constructor(opts: { port: number; host?: string; callTimeoutMs?: number }) {
    this.opts = opts;
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === 1;
  }

  get snapshot(): RawState | null {
    return this.lastState;
  }

  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({
        host: this.opts.host ?? '127.0.0.1',   // 只绑回环
        port: this.opts.port,
        verifyClient: (info: { origin: string }) => {
          if (!info.origin) return true; // Local CLI diagnostics, no browser origin.
          try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(info.origin).hostname); } catch { return false; }
        },
      });
      this.wss.on('listening', () => resolve());
      this.wss.on('error', reject);

      this.wss.on('connection', (ws) => {
        // 多连接共存 + 稳定选主。
        //
        // ⚠ 千万**不要**强制关闭旧连接：页面侧有自动重连，被踢的页面会立刻连回来，
        // 于是两个页面互相顶掉对方、无限重连，所有请求都卡在中间（实测把 apply 拖到超时）。
        // 正确做法：旧连接放着不管，只把"活跃"指针移到新连接；旧连接自然关闭时再补位。
        this.live.add(ws);
        const wasActive = this.socket === ws;
        this.socket = ws;                       // 最新连接即活跃画布（用户刷新页面即接管）
        if (!wasActive) for (const cb of this.listeners) cb(true);

        ws.on('message', (data) => this.onMessage(data.toString(), ws));
        ws.on('close', () => {
          this.live.delete(ws);
          for (const [id, socket] of this.windows) if (socket === ws) { this.windows.delete(id); this.states.delete(id); }
          for (const [id, p] of this.pending) if (p.socket === ws) {
            clearTimeout(p.timer); p.reject(new Error('GGB_SESSION_DEAD: 请求绑定的画板已断开')); this.pending.delete(id);
          }
          if (this.socket !== ws) return;        // 不是活跃连接，无需处理

          // 活跃连接断了：优先补位到其它仍存活的连接（比如用户浏览器那个）
          const next = [...this.live].pop();
          if (next && next.readyState === 1) {
            this.socket = next;
            for (const cb of this.listeners) cb(true);
            return;
          }

          this.socket = null;
          for (const cb of this.listeners) cb(false);
        });
      });
    });
  }

  private onMessage(raw: string, socket: WebSocket): void {
    let msg: { id?: string; payload?: unknown; error?: string; type?: string; windowId?: string; bindingToken?: string } = {};
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'hello') {
      if (msg.windowId) {
        const ticket = this.tickets.get(msg.windowId);
        if (!ticket || ticket.expires < Date.now() || ticket.token !== msg.bindingToken) { socket.close(1008, 'Invalid window binding'); return; }
        this.tickets.delete(msg.windowId);
        const previous = this.windows.get(msg.windowId);
        if (previous && previous !== socket && previous.readyState === 1) { socket.close(1008, 'Window already bound'); return; }
        this.windows.set(msg.windowId, socket);
      }
      return;
    }

    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      if (p.socket !== socket) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error));
      else {
        if (isRawState(msg.payload)) {
          this.lastState = msg.payload;
          for (const [id, ws] of this.windows) if (ws === socket) this.states.set(id, msg.payload);
        }
        p.resolve(msg.payload);
      }
    }
  }

  /**
   * 向页面发一个操作并等待结果。
   *
   * @param timeoutMs 单次调用超时。**按操作类型区分**：apply 要等 GeoGebra 就绪
   *   + 回放 + 体检，首次调用可能很慢；getState 只读，可以短。
   *   超时**不等于失败**——见 tools.ts 的降级处理（返回部分结果而非裸抛）。
   */
  issueBinding(windowId: string): string {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(windowId)) throw new Error('窗口 ID 不合法');
    for (const [id, ticket] of this.tickets) if (ticket.expires < Date.now()) this.tickets.delete(id);
    const token = randomBytes(24).toString('hex');
    this.tickets.set(windowId, { token, expires: Date.now() + 60_000 });
    return token;
  }
  forWindow(windowId: string): Pick<GgbBridgeClient, 'connected' | 'snapshot' | 'call'> {
    const client = this;
    return {
      get connected() { return client.windows.get(windowId)?.readyState === 1; },
      get snapshot() { return client.states.get(windowId) ?? null; },
      call<T>(op: string, args?: unknown, timeoutMs?: number) { return client.call<T>(op, args, timeoutMs, windowId); },
    };
  }
  call<T>(op: string, args?: unknown, timeoutMs?: number, windowId?: string): Promise<T> {
    const socket = windowId ? this.windows.get(windowId) : this.socket;
    if (!socket || socket.readyState !== 1) {
      return Promise.reject(new Error(
        'GGB_SESSION_DEAD: 没有已连接的画布。请确认工作台页面已打开且 GeoGebra 已就绪。',
      ));
    }
    const id = `c${++this.seq}`;
    const limit = timeoutMs ?? this.opts.callTimeoutMs ?? 15000;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`GGB_CALL_TIMEOUT: ${op} 超过 ${limit}ms 未返回（结果可能已生效但未确认）`));
      }, limit);

      this.pending.set(id, {
        socket,
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      socket.send(JSON.stringify({ id, op, args }));
    });
  }

  async stop(): Promise<void> {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('daemon 正在关闭'));
    }
    this.pending.clear();
    for (const ws of this.live) ws.close();
    await new Promise<void>((r) => {
      if (!this.wss) return r();
      this.wss.close(() => r());
    });
    this.socket = null;
    this.wss = null;
  }
}

function isRawState(v: unknown): v is RawState {
  return !!v && typeof v === 'object' && Array.isArray((v as RawState).commands);
}

export type { RawState, RawApplyResult };
