/**
 * 内置 Agent（OpenCode）—— 解析、argv 组装与会话标记。
 *
 * 事件形状取自 2026-10-18 在本机 1.19.3 上抓的真实样本
 * （test/fixtures/opencode-stream-sample.jsonl，带 MCP 工具调用的那一轮）。
 */

import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { opencode, RUNTIMES, type AgentEvent } from '../src/defs.ts';
import { OPENCODE_BYOK_PROVIDER_ID } from '../src/opencode-config.ts';

const J = (o: unknown) => JSON.stringify(o);

describe('opencode.parseLine — --format json 归一', () => {
  it('step_start 带出 session id（capture-style 的捕获点）', () => {
    const e = opencode.parseLine(J({
      type: 'step_start',
      sessionID: 'ses_eb1c0f8adffecmTPwp1544Bfin',
      part: { type: 'step-start', sessionID: 'ses_eb1c0f8adffecmTPwp1544Bfin' },
    })) as Extract<AgentEvent, { kind: 'session' }>;
    expect(e.kind).toBe('session');
    expect(e.sessionId).toBe('ses_eb1c0f8adffecmTPwp1544Bfin');
  });

  it('text 整块下发为 text-delta（它不分块）', () => {
    const e = opencode.parseLine(J({
      type: 'text',
      sessionID: 'ses_1',
      part: { type: 'text', messageID: 'msg_1', text: '1,2,3' },
    })) as Extract<AgentEvent, { kind: 'text-delta' }>;
    expect(e.kind).toBe('text-delta');
    expect(e.text).toBe('1,2,3');
    expect(e.messageId).toBe('msg_1');
  });

  it('tool_use 一次给两条：tool-call + tool-result（名字剥掉 server 前缀）', () => {
    const out = opencode.parseLine(J({
      type: 'tool_use',
      sessionID: 'ses_1',
      part: {
        type: 'tool',
        tool: 'mathmover_ggb_apply',
        callID: 'call_00_05mm4c9x35siyz5v52cjapm4',
        state: { status: 'completed', input: { commands: ['A=(0,0)'] }, output: 'ok' },
      },
    })) as AgentEvent[];
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'tool-call', name: 'ggb_apply', toolCallId: 'call_00_05mm4c9x35siyz5v52cjapm4' });
    expect((out[0] as Extract<AgentEvent, { kind: 'tool-call' }>).input).toEqual({ commands: ['A=(0,0)'] });
    expect(out[1]).toMatchObject({ kind: 'tool-result', toolCallId: 'call_00_05mm4c9x35siyz5v52cjapm4', isError: false });
  });

  it('工具还在跑时只发 tool-call，不发结果', () => {
    const out = opencode.parseLine(J({
      type: 'tool_use',
      part: { type: 'tool', tool: 'mathmover_ggb_get_state', callID: 'c1', state: { status: 'running' } },
    })) as AgentEvent[];
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('tool-call');
  });

  it('工具失败标 isError（error 字段优先于 output）', () => {
    const out = opencode.parseLine(J({
      type: 'tool_use',
      part: { type: 'tool', tool: 'bash', callID: 'c2', state: { status: 'error', error: '炸了', output: 'noise' } },
    })) as AgentEvent[];
    expect(out[1]).toMatchObject({ kind: 'tool-result', isError: true, output: '炸了' });
  });

  it('callID 缺失时退回 part.id（前端按它去重，空串会重影）', () => {
    const out = opencode.parseLine(J({
      type: 'tool_use',
      part: { type: 'tool', tool: 'mathmover_ggb_apply', id: 'prt_9', state: { status: 'completed', output: 'ok' } },
    })) as AgentEvent[];
    expect((out[0] as Extract<AgentEvent, { kind: 'tool-call' }>).toolCallId).toBe('prt_9');
  });

  it('step_finish → usage（读 part.tokens）', () => {
    const e = opencode.parseLine(J({
      type: 'step_finish',
      part: { type: 'step-finish', reason: 'stop', tokens: { total: 9442, input: 96, output: 2 } },
    })) as Extract<AgentEvent, { kind: 'usage' }>;
    expect(e).toMatchObject({ kind: 'usage', inputTokens: 96, outputTokens: 2 });
  });

  it('error 帧必须浮出来（opencode 出错也是退出码 0）', () => {
    const e = opencode.parseLine(J({
      type: 'error',
      sessionID: 'ses_1',
      error: { name: 'UnknownError', data: { message: 'Unexpected server error.', ref: 'err_1' } },
    })) as Extract<AgentEvent, { kind: 'error' }>;
    expect(e.kind).toBe('error');
    expect(e.message).toBe('Unexpected server error.');
  });

  it('非 JSON 行退化为 raw（与三条 CLI 同一约定），未知 type 不下发也不抛错', () => {
    expect(opencode.parseLine('npm notice run opencode')).toMatchObject({ kind: 'raw' });
    expect(opencode.parseLine(J({ type: 'something-new' }))).toBeNull();
    expect(() => opencode.parseLine(J({ type: 'tool_use' }))).not.toThrow();
    expect(() => opencode.parseLine(J({ type: 'text', part: {} }))).not.toThrow();
  });

  it('真实样本回放：一条 session + 一条 ggb_apply 往返 + 一段正文', () => {
    const raw = fs.readFileSync(new URL('./fixtures/opencode-stream-sample.jsonl', import.meta.url), 'utf-8');
    const events: AgentEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const parsed = opencode.parseLine(line);
      if (!parsed) continue;
      events.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    }
    expect(events.map((e) => e.kind)).toEqual([
      'session', 'tool-call', 'tool-result', 'usage', 'session', 'text-delta', 'usage',
    ]);
    const session = events.find((e) => e.kind === 'session') as Extract<AgentEvent, { kind: 'session' }>;
    expect(session.sessionId).toMatch(/^ses_/);
    const call = events.find((e) => e.kind === 'tool-call') as Extract<AgentEvent, { kind: 'tool-call' }>;
    expect(call.name).toBe('ggb_apply');
  });
});

describe('opencode.buildArgs — 实测过的旗标集', () => {
  const base = { prompt: '画个正方体', mcpConfigPath: '/tmp/mcp.json', cwd: '/sandbox/cw-1' };

  it('--dir 恒在，且与 spawn 的 cwd 同值（不认进程 cwd，漏了会静默写错地方）', () => {
    const args = opencode.buildArgs(base);
    expect(args[args.indexOf('--dir') + 1]).toBe('/sandbox/cw-1');
    expect(args.slice(0, 3)).toEqual(['run', '--format', 'json']);
  });

  it('--dangerously-skip-permissions 无条件传（它不在 --help 里，不能靠探测决定）', () => {
    expect(opencode.buildArgs(base)).toContain('--dangerously-skip-permissions');
    expect(opencode.buildArgs({ ...base, cwd: undefined })).toContain('--dangerously-skip-permissions');
  });

  it('-s 只在有 resumeSessionId 时出现', () => {
    expect(opencode.buildArgs(base)).not.toContain('-s');
    const args = opencode.buildArgs({ ...base, resumeSessionId: 'ses_abc' });
    expect(args[args.indexOf('-s') + 1]).toBe('ses_abc');
  });

  it('-m 带上自定义 provider 前缀，且不重复加', () => {
    const args = opencode.buildArgs({ ...base, model: 'deepseek-v3' });
    expect(args[args.indexOf('-m') + 1]).toBe(`${OPENCODE_BYOK_PROVIDER_ID}/deepseek-v3`);
    const again = opencode.buildArgs({ ...base, model: `${OPENCODE_BYOK_PROVIDER_ID}/deepseek-v3` });
    expect(again[again.indexOf('-m') + 1]).toBe(`${OPENCODE_BYOK_PROVIDER_ID}/deepseek-v3`);
  });

  it('图片以 --file=<路径> 追加在最末（等号形式 + 无位置参数，绕开贪婪吞参）', () => {
    const args = opencode.buildArgs({ ...base, imagePaths: ['/sandbox/cw-1/mm-img-a/0.png', '/sandbox/cw-1/mm-img-a/1.jpg'] });
    expect(args.slice(-2)).toEqual([
      '--file=/sandbox/cw-1/mm-img-a/0.png',
      '--file=/sandbox/cw-1/mm-img-a/1.jpg',
    ]);
    expect(args).not.toContain('画个正方体'); // prompt 走 stdin
  });

  it('会话/图片落盘标记齐备（capture-style + 工作区内落图）', () => {
    expect(opencode.resumesSessionViaCli).toBe(true);
    expect(opencode.capturesSessionIdFromStream).toBe(true);
    expect(opencode.promptViaStdin).toBe(true);
    expect(opencode.imageDelivery).toBe('argv-paths');
    expect(opencode.imageMaterializeInCwd).toBe(true);
  });
});

describe('registry', () => {
  it('opencode 是内置位专用，不进 RUNTIMES（否则会作为第四个本机 agent 出现在选择器里）', () => {
    expect(RUNTIMES.map((r) => r.id).sort()).toEqual(['claude-code', 'codex', 'dsh']);
    expect(RUNTIMES).not.toContain(opencode);
    expect(opencode.id).toBe('opencode');
  });
});
