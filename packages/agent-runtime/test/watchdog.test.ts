/**
 * watchdog 分级（对齐 OpenDesign 的 inactivityTimeoutMs / firstOutputTimeoutMs）。
 *
 * 锁住的语义：
 * - 首输出硬顶：启动到第一条**实质输出**（text/thinking/tool）的绝对时限；
 * - 状态/心跳帧（session、raw、usage）**不**顺延硬顶——只刷状态不干活的挂死才兜得住；
 * - 实质输出一出即解除，长静默的合法收尾不再被误杀。
 *
 * 桩 CLI 用 node -e 跑真实子进程（同 run.test.ts 的形态）。
 */
import { describe, expect, it } from 'vitest';
import { runAgent } from '../src/run.ts';
import type { AgentEvent, RuntimeDefinition } from '../src/defs.ts';

function fakeDef(overrides: Partial<RuntimeDefinition> = {}, script = ''): RuntimeDefinition {
  return {
    id: 'fake-cli',
    displayName: 'Fake CLI',
    executable: process.execPath,
    probeArgs: ['--version'],
    parseLine: (line: string): AgentEvent | null => {
      if (line.startsWith('text:')) return { kind: 'text', text: line.slice(5) };
      if (line.startsWith('beat:')) return { kind: 'session', sessionId: 'hb' };
      return { kind: 'raw', line };
    },
    buildArgs: () => ['-e', script],
    ...overrides,
  } as unknown as RuntimeDefinition;
}

async function collect(opts: Omit<Parameters<typeof runAgent>[0], 'onEvent'>) {
  const events: AgentEvent[] = [];
  const handle = runAgent({ ...opts, onEvent: (e) => events.push(e) });
  await handle.done;
  return events;
}

describe('firstOutputTimeoutMs — 首输出硬顶', () => {
  it('一直不吐实质输出：到点报「首输出超时」并杀进程', async () => {
    const events = await collect({
      def: fakeDef({}, 'setTimeout(() => {}, 5000)'),
      prompt: 'x',
      mcpConfigPath: 'x.json',
      firstOutputTimeoutMs: 300,
    });
    const err = events.find((e) => e.kind === 'error');
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toContain('首输出超时');
  });

  it('实质输出一出即解除：其后长静默不误杀', async () => {
    const events = await collect({
      def: fakeDef({}, 'console.log("text:hi"); setTimeout(() => {}, 1200)'),
      prompt: 'x',
      mcpConfigPath: 'x.json',
      firstOutputTimeoutMs: 400,
    });
    expect(events.some((e) => e.kind === 'text')).toBe(true);
    expect(events.some((e) => e.kind === 'error')).toBe(false);
  });

  it('状态帧不顺延硬顶：刷心跳不干活照样超时', async () => {
    const events = await collect({
      // 第一拍同步吐出（躲开 node 冷启动的时序抖动），之后每 60ms 一拍
      def: fakeDef({}, 'let n = 0; console.log("beat:" + (n++)); const t = setInterval(() => console.log("beat:" + (n++)), 60); setTimeout(() => clearInterval(t), 3000)'),
      prompt: 'x',
      mcpConfigPath: 'x.json',
      firstOutputTimeoutMs: 500,
    });
    // 心跳一直在刷（session 帧），但没有实质输出
    expect(events.some((e) => e.kind === 'session')).toBe(true);
    const err = events.find((e) => e.kind === 'error');
    expect((err as { message: string } | undefined)?.message).toContain('首输出超时');
  });

  it('不设首输出超时 = 不启用：迟来的输出不被判超时', async () => {
    const events = await collect({
      def: fakeDef({}, 'setTimeout(() => console.log("text:late"), 300); setTimeout(() => {}, 450)'),
      prompt: 'x',
      mcpConfigPath: 'x.json',
      // 不设 firstOutputTimeoutMs
    });
    expect(events.some((e) => e.kind === 'text')).toBe(true);
    expect(events.some((e) => e.kind === 'error')).toBe(false);
  });
});
