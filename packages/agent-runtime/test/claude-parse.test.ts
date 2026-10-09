/**
 * Claude Code stream-json 解析回归。
 *
 * 夹具是 2026-10-09 抓的真实输出（scripts/diag-stream-calibrate.mjs）：
 * 一次 ggb_get_state 调用 + 一句回复，覆盖 thinking/tool_use/tool_result/text
 * 与 stream_event 增量全形状。解析规则改了就重放这份样本防退化。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { claudeCode, type AgentEvent } from '../src/defs.ts';

const SAMPLE = fileURLToPath(new URL('./fixtures/claude-stream-sample.jsonl', import.meta.url));

function replay(line: string): AgentEvent[] {
  const parsed = claudeCode.parseLine(line);
  if (!parsed) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

const lines = fs.readFileSync(SAMPLE, 'utf-8').split('\n').filter((l) => l.trim());
const events = lines.flatMap(replay);

describe('claudeCode.parseLine — 真实样本重放', () => {
  it('init 带出 session，result 收尾', () => {
    const session = events.find((e) => e.kind === 'session');
    const done = events.find((e) => e.kind === 'done');
    expect(session?.kind === 'session' && session.sessionId).toBeTruthy();
    expect(done?.kind === 'done' && done.sessionId).toBeTruthy();
    expect(done?.kind === 'done' && done.resultText).toBeTruthy();
  });

  it('工具名剥掉 mcp__ 前缀，tool-call/tool-result 成对', () => {
    const calls = events.filter((e) => e.kind === 'tool-call');
    const results = events.filter((e) => e.kind === 'tool-result');
    expect(calls.length).toBe(1);
    expect(results.length).toBe(1);
    if (calls[0].kind === 'tool-call') {
      expect(calls[0].name).toBe('ggb_get_state'); // 不是 mcp__mathmover__ggb_get_state
      expect(calls[0].toolCallId).toBeTruthy();
    }
    if (results[0].kind === 'tool-result' && calls[0].kind === 'tool-call') {
      expect(results[0].toolCallId).toBe(calls[0].toolCallId);
    }
  });

  it('增量文本与完整块文本一字不差（两个通道都不丢）', () => {
    const deltas = events.filter((e) => e.kind === 'text-delta').map((e) => (e.kind === 'text-delta' ? e.text : ''));
    const fulls = events.filter((e) => e.kind === 'text').map((e) => (e.kind === 'text' ? e.text : ''));
    expect(deltas.length).toBeGreaterThan(0);
    expect(fulls.length).toBeGreaterThan(0);
    expect(deltas.join('')).toBe(fulls.join(''));
  });

  it('thinking 有完整块（增量块另行归一为 thinking 小块）', () => {
    // 真实样本里 thinking 完整块与 thinking_delta 小块同为 kind:'thinking'
    const thinkings = events.filter((e) => e.kind === 'thinking');
    expect(thinkings.length).toBeGreaterThan(0);
  });

  it('message_delta 映射为 usage', () => {
    const usage = events.find((e) => e.kind === 'usage');
    expect(usage).toBeTruthy();
    if (usage?.kind === 'usage') expect(usage.outputTokens).toBeGreaterThan(0);
  });

  it('结构性噪音不下发（null）', () => {
    const noise = '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}';
    expect(claudeCode.parseLine(noise)).toBeNull();
    expect(claudeCode.parseLine('{"type":"system","subtype":"status","status":"requesting"}')).toBeNull();
  });

  it('一行多块的 assistant 全部转出（text+tool_use 不丢工具调用）', () => {
    const multi =
      '{"type":"assistant","message":{"content":[{"type":"text","text":"看好了"},{"type":"tool_use","id":"call_x","name":"mcp__mathmover__ggb_apply","input":{"commands":[]}}]}}';
    const parsed = claudeCode.parseLine(multi);
    expect(Array.isArray(parsed)).toBe(true);
    const evs = parsed as AgentEvent[];
    expect(evs.map((e) => e.kind)).toEqual(['text', 'tool-call']);
  });

  it('非 JSON 行透传 raw', () => {
    const ev = claudeCode.parseLine('warning: something odd');
    expect(ev).toEqual({ kind: 'raw', line: 'warning: something odd' });
  });

  it('每行都不抛错、已知事件全部有归一', () => {
    for (const l of lines) expect(() => claudeCode.parseLine(l)).not.toThrow();
    const kinds = new Set(events.map((e) => e.kind));
    expect(kinds.has('session')).toBe(true);
    expect(kinds.has('tool-call')).toBe(true);
    expect(kinds.has('tool-result')).toBe(true);
    expect(kinds.has('done')).toBe(true);
  });
});
