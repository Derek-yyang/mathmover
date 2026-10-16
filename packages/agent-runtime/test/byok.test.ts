/**
 * BYOK 构造通路的 LLM 工具循环（对齐 OpenDesign 的 byok-tools 模式）。
 *
 * 锁住：SSE 流式（text-delta 逐块、tool_call 增量拼装）、非流式回落、
 * tool_calls 循环（执行→回喂→再请求）、HTTP 错误如实报、**轮次用尽优雅
 * 收尾（对齐 OpenDesign：已吐正文保留、不发 error）**、cancel、未知工具。
 * fetch 全部打桩，零网络。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runByokAgent, type ByokTool } from '../src/byok.ts';

const events: Array<{ kind: string; [k: string]: unknown }> = [];

afterEach(() => {
  vi.unstubAllGlobals();
  events.length = 0;
});

const tool: ByokTool = {
  name: 'ggb_apply',
  description: '应用指令',
  parameters: { type: 'object', properties: { commands: { type: 'array' } } },
  execute: async (args) => ({ content: `applied:${JSON.stringify(args)}` }),
};

/** 非流式 JSON 应答桩（回落路径）。 */
function mockJsonFetch(replies: Array<() => unknown>) {
  let call = 0;
  return vi.fn(async () => {
    const reply = replies[Math.min(call++, replies.length - 1)]();
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => reply,
    } as unknown as Response;
  });
}

/** SSE 应答桩：每个元素是一次补全的 data 行序列。 */
function mockSseFetch(rounds: string[][]) {
  let call = 0;
  return vi.fn(async () => {
    const lines = rounds[Math.min(call++, rounds.length - 1)];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const l of lines) controller.enqueue(enc.encode(l + '\n'));
        controller.close();
      },
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream' },
      body: stream,
    } as unknown as Response;
  });
}

describe('runByokAgent 工具循环', () => {
  it('SSE 流式：text-delta 逐块、tool_call 增量拼装、回喂后收尾', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal('fetch', mockSseFetch([
      [
        'data: {"choices":[{"delta":{"content":"先看"}}]}',
        'data: {"choices":[{"delta":{"content":"画板"}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"ggb_","arguments":"{\\"comm"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"apply","arguments":"ands\\":[\\"A=(0,0)\\"]}"}}]}}]}',
        'data: [DONE]',
      ],
      [
        'data: {"choices":[{"delta":{"content":"画好了"}}]}',
        'data: [DONE]',
      ],
    ]));
    const run = runByokAgent({
      prompt: '画个点', baseUrl: 'http://localhost:1/v1', apiKey: 'k', model: 'm',
      tools: [{ ...tool, execute: async (args) => { seen.push(args); return { content: 'ok' }; } }],
      onEvent: (e) => events.push(e as never),
    });
    const r = await run.done;
    expect(r.exitCode).toBe(0);
    // 正文按 delta 逐块
    expect(events.filter(e => e.kind === 'text-delta').map(e => e.text)).toEqual(['先看', '画板', '画好了']);
    expect(events.filter(e => e.kind === 'text-phase')).toEqual([
      { kind: 'text-phase', messageId: 'byok-0', phase: 'commentary' },
      { kind: 'text-phase', messageId: 'byok-1', phase: 'final' },
    ]);
    // tool_call 跨帧拼装（name 与 arguments 都是增量）
    expect(seen).toEqual([{ commands: ['A=(0,0)'] }]);
    expect(events.find(e => e.kind === 'tool-call')).toMatchObject({ name: 'ggb_apply', toolCallId: 'c1' });
    expect(events.find(e => e.kind === 'done')).toMatchObject({ status: 'completed' });
  });

  it('非流式回落：正文成块 text 事件', async () => {
    vi.stubGlobal('fetch', mockJsonFetch([
      () => ({ choices: [{ message: { content: '一次性正文' } }] }),
    ]));
    const run = runByokAgent({ prompt: 'x', baseUrl: 'http://localhost:1/v1', apiKey: '', model: 'm', tools: [], onEvent: (e) => events.push(e as never) });
    expect((await run.done).exitCode).toBe(0);
    expect(events.find(e => e.kind === 'text')).toMatchObject({ text: '一次性正文' });
  });

  it('HTTP 错误如实报状态码与片段', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 401, statusText: 'Unauthorized', headers: { get: () => 'application/json' }, text: async () => 'bad key',
    })) as never);
    const run = runByokAgent({ prompt: 'x', baseUrl: 'http://localhost:1/v1', apiKey: '', model: 'm', tools: [], onEvent: (e) => events.push(e as never) });
    expect((await run.done).exitCode).toBeNull();
    expect(events.find(e => e.kind === 'error')).toMatchObject({ message: expect.stringContaining('401') });
  });

  it('未知工具不炸：报错结果回喂后继续循环', async () => {
    vi.stubGlobal('fetch', mockJsonFetch([
      () => ({ choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ghost_tool', arguments: '{}' } }] } }] }),
      () => ({ choices: [{ message: { content: 'ok' } }] }),
    ]));
    const run = runByokAgent({ prompt: 'x', baseUrl: 'http://localhost:1/v1', apiKey: '', model: 'm', tools: [tool], onEvent: (e) => events.push(e as never) });
    expect((await run.done).exitCode).toBe(0);
    expect(events.find(e => e.kind === 'tool-result')).toMatchObject({ isError: true });
  });

  it('轮次用尽：优雅收尾——已吐正文保留、**不发 error**（对齐 OpenDesign）', async () => {
    vi.stubGlobal('fetch', mockSseFetch([[
      'data: {"choices":[{"delta":{"content":"做到一半"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"ggb_apply","arguments":"{}"}}]}}]}',
      'data: [DONE]',
    ]]));
    const run = runByokAgent({ prompt: 'x', baseUrl: 'http://localhost:1/v1', apiKey: '', model: 'm', tools: [tool], maxRounds: 2, onEvent: (e) => events.push(e as never) });
    const r = await run.done;
    expect(r.exitCode).toBe(0);
    expect(events.some(e => e.kind === 'error')).toBe(false);
    expect(events.find(e => e.kind === 'done')).toMatchObject({ status: 'completed', resultText: '做到一半' });
  });

  it('cancel 优雅收尾为 cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(new Error('aborted')));
    })) as never);
    const run = runByokAgent({ prompt: 'x', baseUrl: 'http://localhost:1/v1', apiKey: '', model: 'm', tools: [], onEvent: (e) => events.push(e as never) });
    run.cancel();
    expect((await run.done).exitCode).toBe(0);
    expect(events.find(e => e.kind === 'done')).toMatchObject({ status: 'cancelled' });
  });

  it('端点不合法：直接报错，不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const run = runByokAgent({ prompt: 'x', baseUrl: 'ftp://bad', apiKey: '', model: 'm', tools: [], onEvent: (e) => events.push(e as never) });
    expect((await run.done).exitCode).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
