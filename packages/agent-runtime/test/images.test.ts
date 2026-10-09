/**
 * 图片输入通道 —— 校验、claude stdin JSONL 形状、codex -i 布局、降级占位。
 * 真实形状校准见 scripts/diag-image-input.mjs（2026-10-10 用 case1.png 实测）。
 */

import { describe, expect, it } from 'vitest';
import {
  formatClaudeStreamJsonInput,
  toImagePlaceholder,
  validateImages,
  MAX_IMAGES_PER_TURN,
  type ImageInput,
} from '../src/images.ts';
import { codex, dsh } from '../src/defs.ts';

const png: ImageInput = { mediaType: 'image/png', base64: 'aGVsbG8=', name: '题.png' };

describe('validateImages', () => {
  it('通过合法载荷', () => {
    const r = validateImages([png]);
    expect(r.error).toBeUndefined();
    expect(r.images).toHaveLength(1);
  });

  it('拒超量、拒超大、拒非图片类型', () => {
    expect(validateImages(Array(MAX_IMAGES_PER_TURN + 1).fill(png)).error).toContain('最多');
    expect(validateImages([{ ...png, base64: 'x'.repeat(9 * 1024 * 1024) }]).error).toContain('过大');
    expect(validateImages([{ ...png, mediaType: 'application/pdf' }]).error).toContain('不支持');
  });

  it('非数组/空容错', () => {
    expect(validateImages(undefined).images).toEqual([]);
    expect(validateImages('nope').images).toEqual([]);
  });
});

describe('formatClaudeStreamJsonInput', () => {
  it('图片块在前、文本在后，一行 JSONL', () => {
    const line = formatClaudeStreamJsonInput('求面积', [png]);
    expect(line.endsWith('\n')).toBe(true);
    const e = JSON.parse(line.trim());
    expect(e.type).toBe('user');
    expect(e.message.role).toBe('user');
    expect(e.message.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
    });
    expect(e.message.content[1]).toEqual({ type: 'text', text: '求面积' });
  });

  it('无图时是纯文本块', () => {
    const e = JSON.parse(formatClaudeStreamJsonInput('你好').trim());
    expect(e.message.content).toEqual([{ type: 'text', text: '你好' }]);
  });
});

describe('codex buildArgs 图片布局', () => {
  it('-i 收文件路径且以 -- 终结防吞 prompt', () => {
    const args = codex.buildArgs({
      prompt: 'p',
      mcpConfigPath: 'x.json',
      imagePaths: ['/tmp/a.png', '/tmp/b.png'],
    });
    const i = args.indexOf('-i');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args.slice(i + 1, i + 3)).toEqual(['/tmp/a.png', '/tmp/b.png']);
    expect(args[i + 3]).toBe('--');
    expect(args).toContain('-'); // stdin prompt 哨兵仍在
  });

  it('无图不带 -i/--', () => {
    const args = codex.buildArgs({ prompt: 'p', mcpConfigPath: 'x.json' });
    expect(args).not.toContain('-i');
    expect(args).not.toContain('--');
  });
});

describe('能力旗标与降级占位', () => {
  it('dsh 看不了图，claude/codex 可以', () => {
    expect(dsh.supportsImages).toBe(false);
    expect(codex.supportsImages).toBe(true);
  });

  it('占位文本说明看不到图并要求文字描述', () => {
    const t = toImagePlaceholder(2);
    expect(t).toContain('2 张');
    expect(t).toContain('看不到');
    expect(t).toContain('文字描述');
  });
});
