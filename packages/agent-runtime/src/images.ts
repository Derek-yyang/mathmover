/**
 * 图片输入（"发题目图"的感知侧）。
 *
 * 递送通道因 CLI 而异（2026-10-10 实测，见 scripts/diag-image-input.mjs）：
 * - claude：`--input-format stream-json` 的 stdin JSONL 行，
 *   `user.message.content[]` 里放 Anthropic image 块（必须配 --output-format stream-json）
 * - codex：`-i <file>...` 变长旗标收文件路径——**prompt 前必须 `--` 终结**，
 *   否则 prompt 会被当成第二个图片路径吞掉
 * - dsh：看不了图（supportsImages=false），调用方用 toImagePlaceholder 降级
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ImageInput {
  /** 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' */
  mediaType: string;
  base64: string;
  name?: string;
}

/** 防滥用上限（路由与 UI 共用）。 */
export const MAX_IMAGES_PER_TURN = 4;
export const MAX_IMAGE_BASE64_CHARS = 8 * 1024 * 1024; // ≈6MB 原图

const ALLOWED_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** 校验并清洗图片载荷；返回非法原因（null = 通过）。 */
export function validateImages(images: unknown): { images: ImageInput[]; error?: string } {
  if (!Array.isArray(images)) return { images: [] };
  if (images.length > MAX_IMAGES_PER_TURN) {
    return { images: [], error: `一次最多 ${MAX_IMAGES_PER_TURN} 张图` };
  }
  const out: ImageInput[] = [];
  for (const raw of images) {
    const img = raw as Partial<ImageInput>;
    const mediaType = String(img?.mediaType ?? '').toLowerCase();
    const base64 = String(img?.base64 ?? '');
    if (!ALLOWED_MEDIA.has(mediaType)) return { images: [], error: `不支持的图片类型：${mediaType || '(空)'}` };
    if (!base64 || base64.length > MAX_IMAGE_BASE64_CHARS) {
      return { images: [], error: '图片过大或为空（单张 base64 上限 8M 字符）' };
    }
    out.push({ mediaType, base64, name: img.name ? String(img.name).slice(0, 120) : undefined });
  }
  return { images: out };
}

/** 看不了图的运行时的文字降级占位（拼进 prompt）。 */
export function toImagePlaceholder(count: number): string {
  return `[用户附上了 ${count} 张题目图片，但你看不到图片内容。请基于文字继续；若必须看图，请提醒用户用文字描述题意。]`;
}

/**
 * claude 的 stdin 输入行（JSONL，一行一条消息）：
 * 图片块在前、文本在后（模型先看图再读指令）。
 */
export function formatClaudeStreamJsonInput(prompt: string, images?: ImageInput[]): string {
  const content: object[] = [];
  for (const img of images ?? []) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    });
  }
  content.push({ type: 'text', text: prompt });
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}

/**
 * 把图片落到临时文件目录（codex `-i` 需要文件路径）。
 * 调用方负责在 spawn 结束后调 cleanup。
 */
export function materializeImages(images: ImageInput[]): { paths: string[]; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-img-'));
  const paths: string[] = [];
  images.forEach((img, i) => {
    const ext = img.mediaType.split('/')[1] ?? 'png';
    const file = path.join(dir, `img-${i}.${ext}`);
    fs.writeFileSync(file, Buffer.from(img.base64, 'base64'));
    paths.push(file);
  });
  return {
    paths,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* 清理失败不致命 */ }
    },
  };
}
