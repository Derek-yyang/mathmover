/**
 * 图片输入通道 —— 校验、claude stdin JSONL 形状、codex -i 布局、prompt-path 说明。
 * 真实形状校准见 scripts/diag-image-input.mjs（2026-10-10 用 case1.png 实测）。
 */

import { describe, expect, it } from 'vitest';
import {
  formatClaudeStreamJsonInput,
  toImagePathNote,
  toImageUndeliveredNote,
  validateImages,
  MAX_IMAGES_PER_TURN,
  type ImageInput,
} from '../src/images.ts';
import { claudeCode, codex, dsh } from '../src/defs.ts';

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

describe('图片递送通道与说明文案', () => {
  it('三家各走一条通道（只描述 CLI 怎么收图，不评判模型能力）', () => {
    expect(claudeCode.imageDelivery).toBe('stdin-json');
    expect(codex.imageDelivery).toBe('argv-paths');
    // dsh 没有任何图片入口 → 落盘把路径交给 agent 自己看
    expect(dsh.imageDelivery).toBe('prompt-path');
  });

  it('prompt-path 说明给出落盘路径，并要求读不了就直说', () => {
    const t = toImagePathNote(['/tmp/a.png', '/tmp/b.png']);
    expect(t).toContain('/tmp/a.png');
    expect(t).toContain('/tmp/b.png');
    expect(t).toContain('2 张');
    expect(t).toContain('读不了');
    expect(t).toContain('不要假装看过');
  });

  it('未送达说明只讲递送事实，不宣称模型看不了图', () => {
    const t = toImageUndeliveredNote(3);
    expect(t).toContain('3 张');
    expect(t).toContain('没有图片递送通道');
    // 回归护栏：不许再把「模型能不能看图」写死进文案
    expect(t).not.toContain('你看不到');
    expect(t).not.toContain('看不了图');
  });
});
