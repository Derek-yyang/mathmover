import { describe, it, expect } from 'vitest';
import { claudeCode, codex, dsh, type AgentEvent } from '../src/defs.ts';
import { RUNTIMES } from '../src/defs.ts';

const J = (o: unknown) => JSON.stringify(o);

describe('claudeCode.parseLine — stream-json 归一', () => {
  it('system/init 带出 session id', () => {
    const e = claudeCode.parseLine(J({
      type: 'system', subtype: 'init', session_id: 'abc-123',
    })) as Extract<AgentEvent, { kind: 'session' }>;
    expect(e.kind).toBe('session');
    expect(e.sessionId).toBe('abc-123');
  });

  it('assistant 的 text 内容 → text 事件', () => {
    const e = claudeCode.parseLine(J({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '已把动点上移' }] },
    })) as Extract<AgentEvent, { kind: 'text' }>;
    expect(e).toEqual({ kind: 'text', text: '已把动点上移' });
  });

  it('assistant 的 tool_use → tool-call（带输入）', () => {
    const e = claudeCode.parseLine(J({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'ggb_apply', input: { commands: ['A=(0,0)'] } }] },
    })) as Extract<AgentEvent, { kind: 'tool-call' }>;
    expect(e.kind).toBe('tool-call');
    expect(e.name).toBe('ggb_apply');
    expect(e.toolCallId).toBe('tu_1');
    expect((e.input as { commands: string[] }).commands).toEqual(['A=(0,0)']);
  });

  it('tool_result → tool-result，能标 isError', () => {
    const e = claudeCode.parseLine(J({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'x', is_error: true }] },
    })) as Extract<AgentEvent, { kind: 'tool-result' }>;
    expect(e.kind).toBe('tool-result');
    expect(e.toolCallId).toBe('tu_1');
    expect(e.isError).toBe(true);
  });

  it('result 收尾 → done，携带 session id', () => {
    const e = claudeCode.parseLine(J({
      type: 'result', subtype: 'success', result: '完成', session_id: 's-9',
    })) as Extract<AgentEvent, { kind: 'done' }>;
    expect(e.kind).toBe('done');
    expect(e.resultText).toBe('完成');
    expect(e.sessionId).toBe('s-9');
  });

  it('非 JSON 行不抛错，退化为 raw', () => {
    const e = claudeCode.parseLine('npm warn something');
    expect(e).toMatchObject({ kind: 'raw' });
  });

  it('未知 type 不抛错', () => {
    expect(claudeCode.parseLine(J({ type: 'something-new', foo: 1 }))).toMatchObject({ kind: 'raw' });
  });

  it('缺字段不抛错', () => {
    expect(() => claudeCode.parseLine(J({ type: 'assistant' }))).not.toThrow();
    expect(() => claudeCode.parseLine(J({ type: 'user', message: {} }))).not.toThrow();
  });
});

describe('claudeCode.buildArgs — 安全与收敛', () => {
  const args = claudeCode.buildArgs({
    prompt: '把动点 B 上移',
    mcpConfigPath: '/tmp/mcp.json',
    sessionId: 'sess-1',
  });

  it('走 stream-json + verbose（流式输出的前提）', () => {
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).toContain('--verbose');
  });

  it('带 MCP 配置，agent 够得着 ggb_* 工具', () => {
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('/tmp/mcp.json');
  });

  it('用 --restricted 去掉 Bash/PowerShell/REPL（本产品不该让 agent 跑命令）', () => {
    expect(args).toContain('--restricted');
  });

  it('支持指定 session id 做多轮续接', () => {
    expect(args[args.indexOf('--session-id') + 1]).toBe('sess-1');
  });

  it('prompt 经 stdin 传递、不进 argv（绕 32k 上限且天然免注入）', () => {
    const evil = 'do it; rm -rf / && echo pwned';
    const a = claudeCode.buildArgs({ prompt: evil, mcpConfigPath: 'x.json' });
    expect(a).not.toContain(evil); // 不进 argv → 不会拼进命令行
    expect(claudeCode.promptViaStdin).toBe(true);
  });
});

describe('codex 解析（2026-10-09 真实输出校准）', () => {
  it('thread.started 带出 session', () => {
    expect(codex.parseLine(J({ type: 'thread.started', thread_id: 't-1' })))
      .toEqual({ kind: 'session', sessionId: 't-1' });
  });

  it('item.completed 的 agent_message → text（started 不下发）', () => {
    expect(codex.parseLine(J({
      type: 'item.completed',
      item: { id: 'item_0', type: 'agent_message', text: '好的' },
    }))).toEqual({ kind: 'text', text: '好的' });
    expect(codex.parseLine(J({
      type: 'item.started',
      item: { id: 'item_0', type: 'agent_message', text: null },
    }))).toBeNull();
  });

  it('mcp_tool_call 成对归一，名字无需再剥前缀', () => {
    expect(codex.parseLine(J({
      type: 'item.started',
      item: { id: 'item_1', type: 'mcp_tool_call', server: 'mathmover', tool: 'ggb_get_state', arguments: { png: true }, status: 'in_progress' },
    }))).toMatchObject({ kind: 'tool-call', name: 'ggb_get_state', toolCallId: 'item_1' });
    expect(codex.parseLine(J({
      type: 'item.completed',
      item: { id: 'item_1', type: 'mcp_tool_call', server: 'mathmover', tool: 'ggb_get_state', result: { ok: true }, error: null, status: 'completed' },
    }))).toMatchObject({ kind: 'tool-result', toolCallId: 'item_1', isError: false });
  });

  it('失败的 mcp_tool_call 标 isError', () => {
    expect(codex.parseLine(J({
      type: 'item.completed',
      item: { id: 'item_2', type: 'mcp_tool_call', tool: 'ggb_apply', result: null, error: { message: 'nope' }, status: 'failed' },
    }))).toMatchObject({ kind: 'tool-result', isError: true });
  });

  it('turn.completed → usage；turn.started 不下发；turn.failed → error', () => {
    expect(codex.parseLine(J({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } })))
      .toMatchObject({ kind: 'usage', inputTokens: 10, outputTokens: 5 });
    expect(codex.parseLine(J({ type: 'turn.started' }))).toBeNull();
    expect(codex.parseLine(J({ type: 'turn.failed', error: { message: '崩了' } })))
      .toMatchObject({ kind: 'error', message: '崩了' });
  });

  it('非 JSON 行 → raw，不抛错', () => {
    expect(codex.parseLine('hello')).toMatchObject({ kind: 'raw' });
  });
});

describe('dsh 解析（one-shot 纯文本，2026-10-09 真实校准）', () => {
  it('非 JSON 行 → text（带换行）', () => {
    expect(dsh.parseLine('画布是空的。')).toEqual({ kind: 'text', text: '画布是空的。\n' });
  });

  it('空行不下发', () => {
    expect(dsh.parseLine('   ')).toBeNull();
  });

  it('JSON 行透传 raw（便于诊断异常输出）', () => {
    expect(dsh.parseLine(J({ text: '结果' }))).toMatchObject({ kind: 'raw' });
    expect(dsh.parseLine('hello')).toMatchObject({ kind: 'text' });
  });
});

describe('registry', () => {
  it('包含三个运行时，且 id 唯一', () => {
    expect(RUNTIMES.map((r) => r.id).sort()).toEqual(['claude-code', 'codex', 'dsh']);
  });
  it('每个定义都必须提供 buildArgs 与 parseLine（接入契约）', () => {
    for (const r of RUNTIMES) {
      expect(typeof r.buildArgs).toBe('function');
      expect(typeof r.parseLine).toBe('function');
    }
  });
});
