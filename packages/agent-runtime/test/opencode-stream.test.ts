import { describe, expect, it } from 'vitest';
import { opencode } from '../src/defs.ts';

const delta = (text: string, partID = 'part', messageID = 'message') => JSON.stringify({
  type: 'mathmover_text_delta', sessionID: 'session', messageID, partID, delta: text,
});
const complete = (text: string, id = 'part', messageID = 'message') => JSON.stringify({
  type: 'text', sessionID: 'session', part: { id, messageID, type: 'text', text },
});
const parser = () => opencode.createLineParser!();

describe('OpenCode public text stream', () => {
  it('forwards fragments immediately and omits the repeated CLI completion', () => {
    const parse = parser();
    expect(parse(delta('第一'))).toEqual({ kind: 'text-delta', text: '第一', messageId: 'message' });
    expect(parse(delta('第二'))).toEqual({ kind: 'text-delta', text: '第二', messageId: 'message' });
    expect(parse(complete('第一第二'))).toBeNull();
    expect(parse(complete('第一第二'))).toBeNull();
    expect(parse(delta('late'))).toBeNull();
  });

  it('recovers a completion tail and supports the original non-streaming fallback', () => {
    const parse = parser();
    parse(delta('前半'));
    expect(parse(complete('前半后半'))).toEqual({ kind: 'text-delta', text: '后半', messageId: 'message' });
    expect(parse(complete('旧版完整文本', 'fallback'))).toEqual({ kind: 'text-delta', text: '旧版完整文本', messageId: 'message' });
  });

  it('scopes reconciliation by part, message, session and process', () => {
    const a = parser(), b = parser();
    a(delta('相同', 'part1'));
    expect(a(delta('相同', 'part2'))).toMatchObject({ text: '相同' });
    expect(a(delta('相同', 'part1', 'other-message'))).toMatchObject({ text: '相同' });
    expect(a(complete('相同', 'part1'))).toBeNull();
    expect(b(complete('相同', 'part1'))).toMatchObject({ text: '相同' });
    expect(a(complete('不同会话', 'part1').replace('"sessionID":"session"', '"sessionID":"other"'))).toMatchObject({ text: '不同会话' });
  });

  it('keeps partial text on cancellation/error without inventing a completed answer', () => {
    const parse = parser();
    expect(parse(delta('已生成部分'))).toMatchObject({ text: '已生成部分' });
    expect(parse(JSON.stringify({ type: 'error', error: { message: 'aborted' } }))).toEqual({ kind: 'error', message: 'aborted' });
    expect(parse(JSON.stringify({ type: 'step_start', sessionID: 'session' }))).toEqual({ kind: 'session', sessionId: 'session' });
    expect(parse('not json')).toEqual({ kind: 'raw', line: 'not json' });
    for (const frame of [delta(''), '{"type":"mathmover_text_delta","delta":"bad"}', '{"type":"mathmover_text_delta","sessionID":"s","messageID":1,"partID":"p","delta":"bad"}']) {
      expect(parse(frame)).toBeNull();
    }
  });
});
