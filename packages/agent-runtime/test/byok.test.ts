/**
 * BYOK 构造通路的 LLM 工具循环（对齐 OpenDesign 的 byok-tools 模式）。
 *
 * 锁住：tool_calls 循环（执行→回喂→再请求）、正文按轮成块、HTTP 错误如实报、
 * 轮次上限防失控、cancel 优雅收尾、未知工具不炸。fetch 全部打桩，零网络。
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

function mockFetch(replies: Array<() => unknown>) {
  let call = 0;
  return vi.fn(async () => {
    const reply = replies[Math.min(call++, replies.length - 1)]();
    return { ok: true, status: 200, json: async () => reply } as Response;
  });
}

describe('runByokAgent 工具循环', () => {
  it('tool_calls 循环：执行→role:tool 回喂→再请求→正文收尾', async () => {
    const seen: unknown[] = [];
    vi.stubGlobal('fetch', mockFetch([
      () => ({ choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ggb_apply', arguments: '{"commands":["A=(0,0)"]}' } }] } }] }),
      () => ({ choices: [{ message: { content: '画好了' } }] }),
    ]));
    const run = runByokAgent({
      prompt: '画个点', baseUrl: 'http://localhost:1/v1', apiKey: 'k', model: 'm',
      tools: [{ ...tool, execute: async (args) => { seen.push(args); return { content: 'ok' }; } }],
      onEvent: (e) => events.push(e as never),
    });
    const r = await run.done;
    expect(r.exitCode).toBe(0);
    expect(seen).toEqual([{ commands: ['A=(0,0)'] }]);
    expect(events.map(e => e.kind)).toEqual(['raw', 'tool-call', 'tool-result', 'text', 'done']);
    expect(events.find(e => e.kind === 'done')).toMatchObject({ status: 'completed' });
    const fetchMock = globalThis.fetch as ReturnType<typeof mockFetch>;
    const secondBody = JSON.parse(((fetchMock.mock.calls[1] as unknown[])[1] as { body: string }).body);
    expect(secondBody.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1', content: 'ok' });
  });

  it('HTTP 错误如实报状态码与片段', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'bad key' }) as Response));
    const run = runByokAgent({ prompt: 'x', baseUrl: 'http://localhost:1/v1', apiKey: '', model: 'm', tools: [], onEvent: (e) => events.push(e as never) });
    expect((await run.done).exitCode).toBeNull();
    expect(events.find(e => e.kind === 'error')).toMatchObject({ message: expect.stringContaining('401') });
  });

  it('未知工具不炸：报错结果回喂后继续循环', async () => {
    vi.stubGlobal('fetch', mockFetch([
      () => ({ choices: [{ message: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'ghost_tool', arguments: '{}' } }] } }] }),
      () => ({ choices: [{ message: { content: 'ok' } }] }),
    ]));
    const run = runByokAgent({ prompt: 'x', baseUrl: 'http://localhost:1/v1', apiKey: '', model: 'm', tools: [tool], onEvent: (e) => events.push(e as never) });
    expect((await run.done).exitCode).toBe(0);
    const result = events.find(e => e.kind === 'tool-result');
    expect(result).toMatchObject({ isError: true });
  });

  it('工具往返超过上限 → 报错收尾（防失控循环）', async () => {
    vi.stubGlobal('fetch', mockFetch([
      () => ({ choices: [{ message: { tool_calls: [{ id: 'c', type: 'function', function: { name: 'ggb_apply', arguments: '{}' } }] } }] }),
    ]));
    const run = runByokAgent({ prompt: 'x', baseUrl: 'http://localhost:1/v1', apiKey: '', model: 'm', tools: [tool], maxRounds: 2, onEvent: (e) => events.push(e as never) });
    expect((await run.done).exitCode).toBeNull();
    expect(events.find(e => e.kind === 'error')).toMatchObject({ message: expect.stringContaining('上限') });
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
