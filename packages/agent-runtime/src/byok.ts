/**
 * BYOK 构造通路（对齐 OpenDesign 的 byok-tools 模式）：**没有 agent CLI 也能跑构造**。
 *
 * 形态：自己当「等效 LLM」的 agent 内核——把 prompt 连同 ggb_* 工具喂给一个
 * OpenAI 兼容的 chat/completions 端点（用户自带 base URL / key / 模型），循环
 * 处理 tool_calls：执行 → 结果作 role:'tool' 回喂 → 再请求，直到模型不再调工具。
 * 工具从哪来由调用方决定（本包只认 ByokTool 接口；MathMover 侧经 MCP stdio
 * 拿真工具，语义与真实 agent 完全一致）。
 *
 * v1 刻意收敛：非流式（每轮一次补全，正文按轮成块出现）、最多 maxRounds 轮、
 * 图片不递送（该通路 canAttachImages=false）。key 只经回环从浏览器到本机服务，
 * 不落服务端磁盘——与「密钥归 agent 配置」的既有裁决一致。
 */

import { randomUUID } from 'node:crypto';
import type { AgentEvent } from './defs.ts';

export interface ByokTool {
  name: string;
  description: string;
  /** JSON Schema（OpenAI function parameters 形状） */
  parameters: Record<string, unknown>;
  execute: (args: unknown) => Promise<{ content: string; isError?: boolean }>;
}

export interface ByokAgentOptions {
  prompt: string;
  /** OpenAI 兼容端点根（形如 https://api.openai.com/v1 或 http://127.0.0.1:15721/v1） */
  baseUrl: string;
  /** 可为空：本地端点（ollama 等）不需要 key */
  apiKey: string;
  model: string;
  tools: ByokTool[];
  systemPrompt?: string;
  /** 工具往返上限（防失控循环）；默认 16 */
  maxRounds?: number;
  /** 单次补全的超时；默认 120s（慢代理下的长思考） */
  requestTimeoutMs?: number;
  onEvent: (e: AgentEvent) => void;
}

export interface ByokRunHandle {
  done: Promise<{ exitCode: number | null }>;
  cancel: () => void;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export function runByokAgent(opts: ByokAgentOptions): ByokRunHandle {
  const abort = new AbortController();
  const maxRounds = opts.maxRounds ?? 16;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 120_000;
  const base = opts.baseUrl.trim().replace(/\/+$/, '');
  const toolsPayload = opts.tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  opts.onEvent({ kind: 'raw', line: '# 启动 内置构造 Agent（BYOK）' });

  const done = (async () => {
    if (!/^https?:\/\//i.test(base)) {
      opts.onEvent({ kind: 'error', message: 'API 端点无效：需要 http(s):// 开头的 OpenAI 兼容地址。' });
      return { exitCode: null };
    }
    const messages: ChatMessage[] = [
      ...(opts.systemPrompt ? [{ role: 'system' as const, content: opts.systemPrompt }] : []),
      { role: 'user', content: opts.prompt },
    ];

    for (let round = 0; round < maxRounds; round++) {
      if (abort.signal.aborted) {
        opts.onEvent({ kind: 'done', status: 'cancelled' });
        return { exitCode: 0 };
      }
      let reply: { tool_calls?: ChatMessage['tool_calls']; content?: string | null };
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          signal: abort.signal,
          headers: {
            'content-type': 'application/json',
            ...(opts.apiKey.trim() ? { authorization: `Bearer ${opts.apiKey.trim()}` } : {}),
          },
          body: JSON.stringify({
            model: opts.model,
            messages,
            ...(toolsPayload.length ? { tools: toolsPayload } : {}),
          }),
        });
        if (!res.ok) {
          const body = (await res.text().catch(() => '')).slice(0, 300);
          opts.onEvent({ kind: 'error', message: `模型端点返回 ${res.status}：${body || res.statusText}` });
          return { exitCode: null };
        }
        const json = (await res.json()) as { choices?: Array<{ message?: { tool_calls?: ChatMessage['tool_calls']; content?: string | null } }> };
        reply = json.choices?.[0]?.message ?? {};
      } catch (e) {
        if (abort.signal.aborted) {
          opts.onEvent({ kind: 'done', status: 'cancelled' });
          return { exitCode: 0 };
        }
        opts.onEvent({ kind: 'error', message: `请求模型端点失败：${e instanceof Error ? e.message : String(e)}` });
        return { exitCode: null };
      }

      const toolCalls = reply.tool_calls ?? [];
      if (!toolCalls.length) {
        const text = (reply.content ?? '').trim();
        if (text) opts.onEvent({ kind: 'text', text });
        opts.onEvent({ kind: 'done', resultText: text || undefined, status: 'completed' });
        return { exitCode: 0 };
      }

      messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        const tool = opts.tools.find((t) => t.name === call.function.name);
        opts.onEvent({
          kind: 'tool-call',
          name: call.function.name.replace(/^mcp__\w+__/, ''),
          toolCallId: call.id,
          input: safeJson(call.function.arguments),
        });
        if (!tool) {
          const msg = `未知工具：${call.function.name}`;
          opts.onEvent({ kind: 'tool-result', toolCallId: call.id, output: msg, isError: true });
          messages.push({ role: 'tool', tool_call_id: call.id, content: msg });
          continue;
        }
        let result: { content: string; isError?: boolean };
        try {
          result = await tool.execute(safeJson(call.function.arguments));
        } catch (e) {
          result = { content: e instanceof Error ? e.message : String(e), isError: true };
        }
        opts.onEvent({ kind: 'tool-result', toolCallId: call.id, output: result.content, isError: result.isError === true });
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.content });
      }
    }

    opts.onEvent({ kind: 'error', message: `工具往返超过 ${maxRounds} 轮上限，已停止（防失控循环）。` });
    return { exitCode: null };
  })();

  return {
    done,
    cancel: () => abort.abort(),
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

/** 生成一个请求 id（与 runAgent 的 requestId 对齐语义，便于日志对账）。 */
export function byokRequestId(): string {
  return randomUUID();
}
