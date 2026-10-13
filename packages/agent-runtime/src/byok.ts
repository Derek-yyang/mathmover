/**
 * BYOK 构造通路（对齐 OpenDesign 的 byok-tools 模式）：**没有 agent CLI 也能跑构造**。
 *
 * 形态：自己当「等效 LLM」的 agent 内核——把 prompt 连同 ggb_* 工具喂给一个
 * OpenAI 兼容的 chat/completions 端点（base URL / key / 模型来自应用数据目录的
 * BYOK 配置），循环处理 tool_calls：执行 → 结果作 role:'tool' 回喂 → 再请求。
 * 工具从哪来由调用方决定（本包只认 ByokTool 接口；MathMover 侧经 MCP stdio
 * 拿真工具，语义与真实 agent 完全一致）。
 *
 * 对齐 OpenDesign 的三条（2026-10-13）：
 *  1. **流式**：请求 stream:true，正文按 SSE delta 逐块吐（text-delta 事件），
 *     tool_call 的增量片段同样拼装；端点不支持流式时回落非流式 JSON。
 *  2. **轮次上限**（见 maxRounds 默认值）：超限**优雅收尾**——已吐的
 *     正文保留、不发 error（他们的原话：close the stream gracefully）。
 *  3. 图片输入不支持（他们同样未做，输出向媒体工具另论）。
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
  /**
   * 工具往返上限。默认 5：做题主路径要 get_expert_prompt → get_sop_cards →
   * submit_construction → 看体检结果自检，四个依赖步之后才轮到收尾，3 会卡死
   * 自检；5 给正常路径留一次修正空间，跑飞防线意义不变（跑飞是十几个来回）。
   * OpenDesign 的 MAX_BYOK_TOOL_LOOPS=3 适配的是浅链路媒体工具，不照搬。
   */
  maxRounds?: number;
  /** 单次补全的超时；默认 120s（慢代理下的长思考） */
  requestTimeoutMs?: number;
  onEvent: (e: AgentEvent) => void;
}

export interface ByokRunHandle {
  done: Promise<{ exitCode: number | null }>;
  cancel: () => void;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface Reply {
  content: string;
  tool_calls: ToolCall[];
}

/**
 * 消费 OpenAI 风格的 SSE 流：正文 delta 逐块转 text-delta 事件，
 * tool_call 增量片段按 index 拼装（id/name/arguments 可能分多帧到达）。
 */
async function consumeSse(body: ReadableStream<Uint8Array>, onEvent: (e: AgentEvent) => void): Promise<Reply> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let chunk: { choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }> };
      try { chunk = JSON.parse(payload); } catch { continue; }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        onEvent({ kind: 'text-delta', text: delta.content });
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const acc = toolAcc.get(idx) ?? { id: '', name: '', arguments: '' };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        toolAcc.set(idx, acc);
      }
    }
  }
  return {
    content,
    tool_calls: [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map(([, acc], i) => ({
      id: acc.id || `call_${i}`,
      type: 'function' as const,
      function: { name: acc.name, arguments: acc.arguments },
    })),
  };
}

export function runByokAgent(opts: ByokAgentOptions): ByokRunHandle {
  const abort = new AbortController();
  const maxRounds = opts.maxRounds ?? 5;
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
    const messages: Array<Record<string, unknown>> = [
      ...(opts.systemPrompt ? [{ role: 'system', content: opts.systemPrompt }] : []),
      { role: 'user', content: opts.prompt },
    ];
    let lastContent = '';

    for (let round = 0; round < maxRounds; round++) {
      if (abort.signal.aborted) {
        opts.onEvent({ kind: 'done', resultText: lastContent || undefined, status: 'cancelled' });
        return { exitCode: 0 };
      }
      let reply: Reply;
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
            stream: true,
          }),
        });
        if (!res.ok) {
          const body = (await res.text().catch(() => '')).slice(0, 300);
          opts.onEvent({ kind: 'error', message: `模型端点返回 ${res.status}：${body || res.statusText}` });
          return { exitCode: null };
        }
        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('text/event-stream') && res.body) {
          reply = await consumeSse(res.body, opts.onEvent);
        } else {
          // 端点不支持流式：回落非流式 JSON（正文按块补发为 text）
          const json = (await res.json()) as { choices?: Array<{ message?: { tool_calls?: ToolCall[]; content?: string | null } }> };
          const message = json.choices?.[0]?.message ?? {};
          reply = { content: (message.content ?? '').trim(), tool_calls: message.tool_calls ?? [] };
          if (reply.content) opts.onEvent({ kind: 'text', text: reply.content });
        }
      } catch (e) {
        if (abort.signal.aborted) {
          opts.onEvent({ kind: 'done', resultText: lastContent || undefined, status: 'cancelled' });
          return { exitCode: 0 };
        }
        opts.onEvent({ kind: 'error', message: `请求模型端点失败：${e instanceof Error ? e.message : String(e)}` });
        return { exitCode: null };
      }

      lastContent = reply.content || lastContent;
      if (!reply.tool_calls.length) {
        opts.onEvent({ kind: 'done', resultText: reply.content || lastContent || undefined, status: 'completed' });
        return { exitCode: 0 };
      }

      messages.push({
        role: 'assistant',
        content: reply.content || null,
        tool_calls: reply.tool_calls.map((c) => ({ id: c.id, type: 'function', function: c.function })),
      });
      for (const call of reply.tool_calls) {
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

    // 轮次用尽：对齐 OpenDesign 的优雅收尾——已吐正文保留、不发 error，
    // 流正常关（他们原话：close the stream gracefully）。
    opts.onEvent({ kind: 'done', resultText: lastContent || undefined, status: 'completed' });
    return { exitCode: 0 };
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
