/**
 * 专家提示拼装 —— skill 形态、清单元数据、指路行与取卡的行为测试。
 *
 * 原先还有一层「金基线对拍」（text_sha256 / 三计数 / 参与文件哈希逐项断言），
 * 用意是拿 Python 参考实现锁住 TS 的字节产出。参考实现已随一次性生成管线下线，
 * 对拍失去对象，连同 prompt-goldens.json 与 gen_prompt_goldens.py 一并退役。
 */

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  assembleDrawingPack,
  assembleSkill,
  buildCardIndex,
  buildCatalog,
  buildAllowedCommandsSuffix,
  loadSopCards,
  SopAssemblyError,
} from '../src/sop.ts';
import { loadWhitelist } from '../src/whitelist.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('装配错误处理', () => {
  it('未知类别 / 坏引用抛 SopAssemblyError', () => {
    expect(() => assembleSkill('Z', REPO_ROOT)).toThrow(SopAssemblyError);
  });
});

describe('assembleSkill / buildCatalog / loadSopCards —— agent 链路', () => {
  it('skill = 约定 + 通用写法 + 流程；卡片只留指路不内联', () => {
    const { text, metadata } = assembleSkill('A', REPO_ROOT);
    expect(text).toContain('共同输出约定');
    expect(text).toContain('通用 GGB 写法');       // 每题必用的写法在 skill 里
    expect(text).toContain('## 1. 清点对象');        // 流程骨架在
    expect(text).toContain('get_sop_cards');         // 指路行提到取卡工具
    expect(text).not.toContain('```ggb');            // 卡片正文不内联
    expect(metadata.cards).toContain('intersection');
    expect(metadata.cards).not.toContain('view-setup'); // 已剔除、写法并入 ggb-basics
    expect(metadata.cards).not.toContain('fixed-point'); // 已剔除、写法并入 ggb-basics
    expect(metadata.cards).not.toContain('aux-line');    // 已剔除、写法并入 ggb-basics
  });

  it('连续多张卡的槽位合并为一行指路', () => {
    const { text } = assembleSkill('A', REPO_ROOT);
    expect(text).toMatch(/〔写法卡：moving-point-function、moving-point-path、moving-point-region —— 动手前用 get_sop_cards 取用〕/);
    expect(text).not.toMatch(/〔写法卡：[a-z0-9-]+〕〔写法卡/); // 不再粘连
  });

  it('清单带标题、输入与所属步骤（从卡头自动生成）', () => {
    const catalog = buildCatalog('A', REPO_ROOT);
    expect(catalog.length).toBeGreaterThan(10);
    const it0 = catalog.find((c) => c.name === 'intersection')!;
    expect(it0.title).toContain('求交');
    expect(it0.inputs.length).toBeGreaterThan(0);
    expect(it0.step).toBe('4'); // 挂在「建立基准点」
    // 四类清单各自不同
    const dNames = buildCatalog('D', REPO_ROOT).map((c) => c.name);
    expect(dNames).toContain('polyhedron-section');
    expect(dNames).not.toContain('function-object');
  });

  it('loadSopCards 批量取卡；未知名回报并给相近提示', () => {
    const { cards, unknown } = loadSopCards(['intersection', 'locus'], REPO_ROOT);
    expect(cards.map((c) => c.name)).toEqual(['intersection', 'locus']);
    expect(cards[0].text).toContain('Intersect');
    expect(unknown).toEqual([]);

    const miss = loadSopCards(['intersect', 'nosuch'], REPO_ROOT);
    expect(miss.cards).toEqual([]);
    expect(miss.unknown).toEqual(['intersect', 'nosuch']);
    expect(miss.suggestions).toContain('intersection'); // 'intersect' 的相近名
  });
});

describe('buildAllowedCommandsSuffix', () => {  const names = loadWhitelist(REPO_ROOT).names;

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

describe('画图基础包（全库清单）', () => {
  it('全库卡清单不按类别裁剪，也不带流程步骤号', () => {
    const index = buildCardIndex(REPO_ROOT);
    expect(index.length).toBe(18);
    const names = index.map((c) => c.name);
    // 题目增强时 A 类拿不到的三维卡，基础包也该看得到
    expect(names).toContain('3d-frame');
    expect(names).toContain('polyhedron-section');
    for (const c of index) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(Object.hasOwn(c, 'step')).toBe(false);
    }
  });

  it('画图基础包只有公共约定与通用写法，不含专家建模流程', () => {
    const { text } = assembleDrawingPack(REPO_ROOT);
    expect(text).toContain('共同输出约定');
    expect(text).toContain('通用 GGB 写法');
    expect(text).not.toContain('## 1. 清点对象'); // 专家 8 步不该混进来
    expect(text).not.toContain('函数与图像专家');
    expect(text).not.toContain('{{SOP');
  });

  it('不给类别时命令约束同时列 2D 与 3D', () => {
    const names = loadWhitelist(REPO_ROOT).names;
    const both = buildAllowedCommandsSuffix(undefined, names);
    expect(both).toContain('构造命令:');
    expect(both).toContain('3D 构造命令:');
    // 对照：A/B/C 题目增强仍只列 2D
    expect(buildAllowedCommandsSuffix('A', names)).not.toContain('3D 构造命令');
    expect(buildAllowedCommandsSuffix('D', names)).toContain('3D 构造命令');
  });
});
