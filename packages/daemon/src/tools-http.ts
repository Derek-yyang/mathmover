/**
 * HTTP 版工具面 —— 与 GgbTools 同形，但走 daemon 的 HTTP API。
 *
 * 用途：独立的 MCP stdio 进程（mcp-stdio.ts）在被 agent 拉起时，
 * 需要访问 daemon 持有的那块画布，但**不能**自己再开 WebSocket（单会话）。
 * 于是经 127.0.0.1 的 HTTP 工具面中转。
 *
 * 分层：
 *   agent CLI ──stdio──▶ mcp-stdio ──HTTP──▶ daemon ──WS──▶ 页面画布
 */

import type { BoardState, DiffResult } from '@mathmover/ggb-core';
import { libraryToken } from './data-directory.ts';

export interface ToolsLike {
  getState(opts?: { png?: boolean }): Promise<BoardState>;
  /** commands 不传 = daemon 读工作稿 construction.ggb.txt */
  apply(commands?: string[], opts?: { png?: boolean; incremental?: boolean }): Promise<{
    state: BoardState;
    diff: DiffResult;
    applied: string[];
    failedFirstPass: string[];
    durationMs: number;
    incremental?: boolean;
    unconfirmed?: boolean;
  }>;
  // 恒异步：HTTP 版天然是 Promise，本地 GgbTools 也包一层。
  // 类型收成 Promise（不是 `Promise<T> | T`）——那种联合类型会诱导调用方漏 await，
  // 实测踩过：submit_construction 直接 .flatMap 在 Promise 上崩，read_construction
  // 拿 Promise.length 当数组长度、永远返回「工作稿为空」。
  readConstruction(): Promise<string[]>;
  writeConstruction(commands: string[]): Promise<string>;
  reset(): Promise<void>;
  ping(): boolean;
}

export function createHttpBackedTools(daemonUrl: string): ToolsLike {
  const call = async (path: string, init?: RequestInit): Promise<any> => {
    const res = await fetch(`${daemonUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(process.env.MATHMOVER_WINDOW_ID ? {
        'x-mathmover-window': process.env.MATHMOVER_WINDOW_ID, 'x-mathmover-token': libraryToken(),
      } : {}), ...(init?.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((body as { error?: string }).error ?? `daemon ${path} 返回 ${res.status}`);
    }
    return body;
  };

  return {
    async getState(opts = {}) {
      return call(`/api/state?png=${opts.png === false ? 0 : 1}`);
    },
    async apply(commands, opts = {}) {
      return call('/api/apply', {
        method: 'POST',
        body: JSON.stringify({ commands, png: opts.png !== false, incremental: opts.incremental }),
      });
    },
    async readConstruction() {
      return call('/api/construction', { method: 'GET' });
    },
    async writeConstruction(commands) {
      return call('/api/construction', {
        method: 'PUT',
        body: JSON.stringify({ commands }),
      });
    },
    async reset() {
      await call('/api/reset', { method: 'POST' });
    },
    ping() {
      // 同步接口无法等待 HTTP；就绪判定交给 getState 的报错语义（GGB_SESSION_DEAD）
      return true;
    },
  };
}
