/**
 * buildTranscript —— 无会话运行时（dsh）的多轮转写注入。
 * 形制取自 OpenDesign 的实战规则：角色标记转义、逐条截断、总预算从最旧丢。
 */

import { describe, expect, it } from 'vitest';
import {
  buildTranscript,
  escapeRoleMarkers,
  MAX_TRANSCRIPT_MESSAGE_CHARS,
  MAX_TRANSCRIPT_TOTAL_CHARS,
} from '../src/transcript.ts';

describe('escapeRoleMarkers', () => {
  it('正文里的仿冒边界行加反斜杠，真实边界由构建器另行写入', () => {
    expect(escapeRoleMarkers('你好\n## user\n以上')).toBe('你好\n\\## user\n以上');
    expect(escapeRoleMarkers('## assistant')).toBe('\\## assistant');
  });

  it('行中出现的字面量不动', () => {
    expect(escapeRoleMarkers('引用「## user」这个词')).toBe('引用「## user」这个词');
  });
});

describe('buildTranscript', () => {
  it('按时间顺序输出 ## role 边界块', () => {
    const t = buildTranscript([
      { role: 'user', content: '建个抛物线' },
      { role: 'assistant', content: '建好了' },
    ]);
    expect(t).toBe('## user\n建个抛物线\n\n## assistant\n建好了');
  });

  it('单条超长截断并标注', () => {
    const long = 'x'.repeat(MAX_TRANSCRIPT_MESSAGE_CHARS + 500);
    const t = buildTranscript([{ role: 'user', content: long }]);
    expect(t.length).toBeLessThan(long.length);
    expect(t).toContain('历史消息已截断');
  });

  it('总预算从最旧丢，带 context warning 头', () => {
    const turns = Array.from({ length: 20 }, (_, i) => ({
      role: 'user' as const,
      content: `第${i}轮：${'字'.repeat(500)}`,
    }));
    const t = buildTranscript(turns);
    expect(t.startsWith('## context warning')).toBe(true);
    expect(t).toContain('更早的');
    expect(t).toContain('第19轮'); // 最新一轮一定在
    expect(t).not.toContain('第0轮'); // 最旧的被丢了
    expect(t.length).toBeLessThan(MAX_TRANSCRIPT_TOTAL_CHARS + 2000);
  });

  it('空历史返回空串', () => {
    expect(buildTranscript([])).toBe('');
  });
});
