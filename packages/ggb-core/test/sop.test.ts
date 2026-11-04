/**
 * 专家提示拼装 —— 固定清单完整加载、步骤内联、错误处理与补充取卡。
 *
 * 原先还有一层「金基线对拍」（text_sha256 / 三计数 / 参与文件哈希逐项断言），
 * 用意是拿 Python 参考实现锁住 TS 的字节产出。参考实现已随一次性生成管线下线，
 * 对拍失去对象，连同 prompt-goldens.json 与 gen_prompt_goldens.py 一并退役。
 */

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleDrawingPack,
  assembleSkill,
  buildCardIndex,
  buildCatalog,
  buildAllowedCommandsSuffix,
  loadSopCards,
  SopAssemblyError,
  CATEGORY_TO_SKILL,
} from '../src/sop.ts';
import { loadWhitelist } from '../src/whitelist.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const fixtures: string[] = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    if (!path.resolve(dir).startsWith(path.join(os.tmpdir(), 'mm-sop-test-'))) throw new Error('Unsafe cleanup');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-sop-test-'));
  fixtures.push(dir);
  fs.cpSync(path.join(REPO_ROOT, 'skills'), path.join(dir, 'skills'), { recursive: true });
  return dir;
}

describe('装配错误处理', () => {
  it('未知类别 / 坏引用抛 SopAssemblyError', () => {
    expect(() => assembleSkill('Z', REPO_ROOT)).toThrow(SopAssemblyError);
  });

  it.each(['missing', 'nested', 'duplicate', 'malformed', 'outside'])(
    '%s 引用拒绝返回不完整专家包', (kind) => {
      const root = fixtureRoot();
      const skill = path.join(root, 'skills/function-expert/SKILL.md');
      const card = path.join(root, 'skills/shared/sops/function-object.md');
      if (kind === 'missing') fs.unlinkSync(card);
      if (kind === 'nested') fs.appendFileSync(card, '\n{{SOP:intersection}}\n');
      if (kind === 'duplicate') fs.appendFileSync(skill, '\n{{SOP:function-object}}\n');
      if (kind === 'malformed') fs.appendFileSync(skill, '\n{{SOP:bad/name}}\n');
      if (kind === 'outside') {
        const body = fs.readFileSync(skill, 'utf8').replace('{{SOP:function-object}}', '');
        fs.writeFileSync(skill, body.replace('## 1.', '{{SOP:function-object}}\n\n## 1.'));
      }
      expect(() => assembleSkill('A', root)).toThrow(SopAssemblyError);
    },
  );
});

describe('assembleSkill / buildCatalog / loadSopCards —— agent 链路', () => {
  it.each([['A', 11], ['B', 9], ['C', 12], ['D', 13]] as const)(
    '%s 类完整加载固定的 %i 张卡，正文在原步骤内且不混入其他卡', (category, count) => {
      const skill = fs.readFileSync(path.join(REPO_ROOT, 'skills', CATEGORY_TO_SKILL[category], 'SKILL.md'), 'utf8').replace(/\r\n?/g, '\n');
      const refs = [...skill.matchAll(/^\{\{SOP:([a-z0-9-]+)\}\}$/gm)].map((m) => m[1]);
      const { text, metadata } = assembleSkill(category, REPO_ROOT);
      expect(text).toContain('共同输出约定');
      expect(text).toContain('通用 GGB 写法');
      expect(text).toContain('## 1. 清点对象');
      expect(metadata.cards).toEqual(refs);
      expect(metadata.cards).toHaveLength(count);
      expect(metadata.characters).toBe(text.length);
      expect(text).not.toContain('{{SOP');
      expect(text).not.toContain('get_sop_cards');
      expect([...text.matchAll(/^### SOP: ([a-z0-9-]+) /gm)].map((m) => m[1])).toEqual(refs);

      const { cards } = loadSopCards(refs, REPO_ROOT);
      for (const { name, text: body } of cards) {
        // 除卡头层级外，示例和注意事项完整保留，且只出现一次。
        const inline = body.replace(/^# /, '### ');
        expect(text.split(inline)).toHaveLength(2);
        const sourceStep = [...skill.matchAll(/^## [1-9]\d*\.[^\n]*\n[\s\S]*?(?=^## [1-9]\d*\.|(?![\s\S]))/gm)]
          .find((m) => m[0].includes(`{{SOP:${name}}}`))![0];
        const heading = sourceStep.split('\n')[0];
        const section = text.slice(text.indexOf(heading)).split(/\n## [1-9]\d*\./)[0];
        expect(section).toContain(inline);
      }
    },
  );

  it('Windows CRLF 检出与 LF 装配正文一致', () => {
    const root = fixtureRoot();
    const files = [
      'skills/function-expert/SKILL.md', 'skills/shared/ggb-basics.md',
      'skills/shared/generation-rules.md',
      ...buildCatalog('A', root).map((c) => `skills/shared/sops/${c.name}.md`),
    ];
    for (const file of files) {
      const target = path.join(root, file);
      fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'));
    }
    expect(assembleSkill('A', root)).toEqual(assembleSkill('A', REPO_ROOT));
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

describe('通用规则覆盖所有生成入口', () => {
  it.each(['drawing', 'A', 'B', 'C', 'D'])(
    '%s 包含正确斜率写法与创建时显隐规则', (entry) => {
      const { text } = entry === 'drawing'
        ? assembleDrawingPack(REPO_ROOT)
        : assembleSkill(entry, REPO_ROOT);
      expect(text).toContain('不要写 `Slope(A, P)`');
      expect(text).toContain('lineAP = Line(A, P)');
      expect(text).toContain('kAP = Slope(lineAP)');
      expect(text).toContain('SetVisibleInView(kAP, 1, false)');
      expect(text).toContain('纯计算对象创建时就隐藏');
      expect(text).toContain('与定义放在同一次 `ggb_apply`');
      expect(text).toContain('用户操作的滑块和动点');
      expect(text).toContain('不按对象类型一概隐藏');
    },
  );
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
