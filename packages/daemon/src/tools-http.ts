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

export interface ToolsLike {
  getState(opts?: { png?: boolean }): Promise<BoardState>;
  apply(commands: string[], opts?: { png?: boolean }): Promise<{
    state: BoardState;
    diff: DiffResult;
    applied: string[];
    failedFirstPass: string[];
    durationMs: number;
  }>;
  diff(before: string[], after: string[]): Promise<DiffResult> | DiffResult;
  reset(): Promise<void>;
  ping(): boolean;
}

export function createHttpBackedTools(daemonUrl: string): ToolsLike {
  const call = async (path: string, init?: RequestInit): Promise<any> => {
    const res = await fetch(`${daemonUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
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
        body: JSON.stringify({ commands, png: opts.png !== false }),
      });
    },
    async diff(before, after) {
      return call('/api/diff', {
        method: 'POST',
        body: JSON.stringify({ before, after }),
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
