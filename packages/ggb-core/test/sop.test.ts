/**
 * 专家提示拼装 —— 与 prompt-goldens.json 金基线逐字段对拍。
 *
 * 基线由 scripts/gen_prompt_goldens.py 从 Python 实现生成（锁定现行行为）。
 * TS 移植必须字节级复现：text_sha256 / characters / skill_characters /
 * sop_characters / cards / files[].sha256 逐项断言，任何一侧改动都会红。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assembleExpertPrompt,
  buildAllowedCommandsSuffix,
  participatingFiles,
  sha256Utf8,
  SopAssemblyError,
} from '../src/sop.ts';
import { loadWhitelist } from '../src/whitelist.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const goldens = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../src/data/prompt-goldens.json', import.meta.url)), 'utf-8'),
) as {
  goldens: Array<{
    category: string;
    skill: string;
    cards: string[];
    card_count: number;
    text_sha256: string;
    text_bytes_utf8: number;
    characters: number;
    skill_characters: number;
    sop_characters: number;
    files: { path: string; sha256: string }[];
  }>;
};

describe('assembleExpertPrompt — 金基线对拍', () => {
  for (const g of goldens.goldens) {
    it(`类别 ${g.category}（${g.skill}）逐字段一致`, () => {
      const { text, metadata } = assembleExpertPrompt(g.category, REPO_ROOT);
      expect(metadata.cards).toEqual(g.cards);
      expect(metadata.cards.length).toBe(g.card_count);
      expect(metadata.characters).toBe(g.characters);
      expect(metadata.skill_characters).toBe(g.skill_characters);
      expect(metadata.sop_characters).toBe(g.sop_characters);
      expect(sha256Utf8(text)).toBe(g.text_sha256);
      expect(Buffer.byteLength(text, 'utf8')).toBe(g.text_bytes_utf8);
    });

    it(`类别 ${g.category} 参与文件哈希一致（缓存键语义）`, () => {
      expect(participatingFiles(g.category, REPO_ROOT)).toEqual(g.files);
    });
  }

  it('未知类别 / 坏引用抛 SopAssemblyError', () => {
    expect(() => assembleExpertPrompt('Z', REPO_ROOT)).toThrow(SopAssemblyError);
  });
});

describe('buildAllowedCommandsSuffix', () => {
  const names = loadWhitelist(REPO_ROOT).names;

  it('A/B/C 只列 2D 构造命令，D 列 2D+3D', () => {
    const abc = buildAllowedCommandsSuffix('A', names);
    expect(abc).toContain('### 严格语法约束');
    expect(abc).toContain('构造命令:');
    expect(abc).not.toContain('3D 构造命令');
    const d = buildAllowedCommandsSuffix('D', names);
    expect(d).toContain('3D 构造命令');
    expect(d).toContain('属性命令:');
    expect(d).toContain('视图命令:');
  });

  it('白名单名字按小写序输出规范名', () => {
    for (const list of [names['2d'], names['3d'], names.attributes, names.globals]) {
      const lows = list.map((n) => n.toLowerCase());
      expect([...lows].sort()).toEqual(lows);
    }
  });
});
