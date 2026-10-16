/**
 * 最小 MCP stdio 客户端 —— 给 BYOK 构造通路供工具。
 *
 * 为什么不复制工具定义：真实 agent（claude/codex/dsh）经 --mcp-config 拉起
 * mcp-stdio 拿到的工具，就是这里的工具——schema 走 tools/list 现取、执行走
 * tools/call，语义与真实 agent 完全一致（ggb_apply 的账本、体检
 * 全在 daemon 侧，一分不差）。链路同真实 agent：
 *   BYOK 循环 ──stdio──▶ mcp-stdio ──HTTP──▶ daemon ──WS──▶ 页面画布
 *
 * 协议：MCP stdio = 每行一个 JSON-RPC 2.0 消息。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ByokTool } from '@mathmover/agent-runtime';

export interface McpToolSession {
  tools: ByokTool[];
  close: () => void;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export function connectMcpTools(opts: {
  /** mcp-stdio 脚本绝对路径（node 跑 .ts，Node 24+ 原生类型剥离） */
  scriptPath: string;
  env?: Record<string, string | undefined>;
}): Promise<McpToolSession> {
  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn('node', [opts.scriptPath], {
      env: { ...process.env, ...opts.env },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
    let nextId = 1;
    let closed = false;

    const request = (method: string, params: unknown, timeoutMs: number) =>
      new Promise<unknown>((res, rej) => {
        if (closed) return rej(new Error('MCP 会话已关闭'));
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          rej(new Error(`MCP ${method} 超时（${timeoutMs}ms）`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (v) => { clearTimeout(timer); res(v); },
          reject: (e) => { clearTimeout(timer); rej(e); },
        });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });

    const notify = (method: string, params: unknown) => {
      if (!closed) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    };

    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let msg: JsonRpcResponse;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.id === undefined || !pending.has(msg.id)) return;
      const entry = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result);
    });

    const close = () => {
      if (closed) return;
      closed = true;
      lines.close();
      try { child.kill(); } catch { /* 已退出 */ }
    };
    child.on('error', (e) => {
      for (const [, p] of pending) p.reject(e);
      pending.clear();
      close();
      reject(e);
    });
    child.on('exit', () => {
      closed = true;
      for (const [, p] of pending) p.reject(new Error('MCP 子进程提前退出'));
      pending.clear();
    });

    void (async () => {
      try {
        await request('initialize', {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'mathmover-byok', version: '0.1.0' },
        }, 15_000);
        notify('notifications/initialized', {});
        const listed = (await request('tools/list', {}, 15_000)) as {
          tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
        };
        const tools: ByokTool[] = (listed.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description ?? '',
          parameters: t.inputSchema ?? { type: 'object', properties: {} },
          execute: async (args: unknown) => {
            const result = (await request('tools/call', { name: t.name, arguments: args }, 90_000)) as {
              content?: Array<{ type: string; text?: string }>;
              isError?: boolean;
            };
            const text = (result.content ?? [])
              .filter((c) => c.type === 'text' && typeof c.text === 'string')
              .map((c) => c.text)
              .join('\n');
            return { content: text || '(无文本结果)', isError: result.isError === true };
          },
        }));
        resolve({ tools, close });
      } catch (e) {
        close();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });
}
