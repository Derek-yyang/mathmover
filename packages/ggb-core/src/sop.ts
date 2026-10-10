/**
 * 专家提示拼装（agent 链路）。
 *
 * skill 只含「流程 + 每题必用的固定写法」（见 ggb-basics.md），卡片按需抽取。
 * 分工原则（作者裁定）：每题必用的 GGB 写法进 skill，
 * sop 库只留「小范围、可能用而未必用」的条件写法。
 *
 * {{SOP:name}} 插槽在 skill 里只留指路行（保持「哪一步用哪张卡」的映射，不搬正文），
 * 具体写法由 get_sop_cards 按名批量抽取。SKILL.md 文件本身不改，由装配器决定形态。
 *
 * 原先还有卡片原位内联的 assembleExpertPrompt / expertPromptWithSuffix，
 * 拿去与 Python expert_prompts.py 逐字节对拍（prompt-goldens.json）。
 * 那套随一次性生成管线下线一并退役，现在只留 agent 链路这一套。
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadWhitelist, type WhitelistNames } from './whitelist.ts';

export const CATEGORY_TO_SKILL: Record<string, string> = {
  A: 'function-expert',
  B: 'planar-geometry-expert',
  C: 'conic-expert',
  D: 'solid-geometry-expert',
};

const SOP_REFERENCE = /^[ \t]*\{\{SOP:([a-z0-9-]+)\}\}[ \t]*$/gm;
// (?![\s\S]) = 串尾（Python 的 \Z）；multiline 下 $ 是行尾，不能混用
const STEP_BLOCK = /^## ([1-9]\d*)\.[^\n]*\n.*?(?=^## [1-9]\d*\.|(?![\s\S]))/gms;

function stripFrontmatter(text: string): string {
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) return text.slice(end + 4).replace(/^\n+/, '');
  }
  return text;
}

/**
 * 文本模式的读法（universal newlines：\r\n → \n），再 rstrip。
 * 卡片在 Windows 检出可能是 CRLF，不归一会让装配产物随检出方式漂移。
 */
function read(file: string): string {
  return fs.readFileSync(file, 'utf-8').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

export class SopAssemblyError extends Error {}

function skillPath(rootDir: string, category: string): string {
  const skill = CATEGORY_TO_SKILL[category];
  if (!skill) throw new SopAssemblyError(`未知专家类别: ${JSON.stringify(category)}`);
  return path.join(rootDir, 'skills', skill, 'SKILL.md');
}

function sopCardPath(rootDir: string, name: string, category: string): string {
  if (typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name)) {
    throw new SopAssemblyError(`非法 SOP 名称: ${JSON.stringify(name)}`);
  }
  const card = path.join(rootDir, 'skills', 'shared', 'sops', `${name}.md`);
  if (!fs.existsSync(card)) {
    throw new SopAssemblyError(`SOP 卡缺失: ${card}（${CATEGORY_TO_SKILL[category]}）`);
  }
  return card;
}

function sopNames(body: string, category: string): string[] {
  const names = [...body.matchAll(new RegExp(SOP_REFERENCE.source, 'gm'))].map((m) => m[1]);
  const skill = CATEGORY_TO_SKILL[category];
  if (names.length === 0 || body.replace(new RegExp(SOP_REFERENCE.source, 'gm'), '').includes('{{SOP')) {
    throw new SopAssemblyError(`${skill}: SOP 插入位置缺失或格式错误；应独占一行写 {{SOP:card-name}}`);
  }
  if (new Set(names).size !== names.length) {
    throw new SopAssemblyError(`${skill}: SOP 插入位置重复`);
  }
  const blocks = [...body.matchAll(new RegExp(STEP_BLOCK.source, 'gms'))].map((m) => m[0]);
  const steps = [...body.matchAll(new RegExp(STEP_BLOCK.source, 'gms'))].map((m) => m[1]);
  if (new Set(steps).size !== steps.length) {
    throw new SopAssemblyError(`${skill}: 编号步骤重复`);
  }
  const inBlocks = new Set(
    blocks.join('').matchAll(new RegExp(SOP_REFERENCE.source, 'gm')),
  );
  const inBlockNames = new Set([...inBlocks].map((m) => m[1]));
  if (inBlockNames.size !== names.length || !names.every((n) => inBlockNames.has(n))) {
    throw new SopAssemblyError(`${skill}: SOP 插入位置必须位于编号步骤`);
  }
  return names;
}

// ── agent 链路：skill 与卡库分家 ────────────────────────────────

export interface SkillAssembly {
  text: string;
  metadata: {
    category: string;
    skill: string;
    /** 流程里指到的写法卡（顺序即流程顺序） */
    cards: string[];
    characters: number;
  };
}

export interface SopCatalogEntry {
  name: string;
  /** 卡头副标题，如「求交与多结果承接」 */
  title: string;
  /** 卡头「输入：」行——什么情况下该取这张卡 */
  inputs: string;
  /** 挂在流程第几步（如 "4"）；未挂在编号步骤时为空 */
  step: string;
}

/** 卡头元数据：`# SOP: name — title` + `输入：...` 行。清单从这里自动生成，零维护。 */
export function readCardMeta(rootDir: string, name: string): { title: string; inputs: string } {
  const body = read(sopCardPath(rootDir, name, '?'));
  const head = /^#\s*SOP:\s*[a-z0-9-]+\s*—\s*(.+)$/m.exec(body);
  const inputs = /^输入：(.*)$/m.exec(body);
  return {
    title: (head?.[1] ?? '').trim(),
    inputs: (inputs?.[1] ?? '').trim(),
  };
}

/** 流程里的 {{SOP:x}} 槽位 → 「写法卡指路」行；连续多张合并为一行。 */
function slotsToPointer(skillBody: string): string {
  const replaced = skillBody.replace(
    new RegExp(SOP_REFERENCE.source, 'gm'),
    (_m, name: string) => `〔写法卡：${name}〕`,
  );
  return replaced.replace(
    /(?:^〔写法卡：[a-z0-9-]+〕\n)+/gm,
    (whole) => {
      const names = [...whole.matchAll(/〔写法卡：([a-z0-9-]+)〕/g)].map((m) => m[1]);
      return `〔写法卡：${names.join('、')} —— 动手前用 get_sop_cards 取用〕\n`;
    },
  );
}

/**
 * agent 链路的 skill：共同输出约定 + 通用 GGB 写法 + 流程（卡片只留指路）。
 * 每题必用的写法在 ggb-basics.md，不在 sop 库——这是作者裁定的分工。
 */
export function assembleSkill(category: string, rootDir: string): SkillAssembly {
  const skillRaw = stripFrontmatter(read(skillPath(rootDir, category)));
  const names = sopNames(skillRaw, category); // 借老校验：槽位必须在编号步骤内、不重复
  const body = slotsToPointer(skillRaw);
  const text = [
    read(path.join(rootDir, 'skills', 'shared', 'generation-rules.md')),
    read(path.join(rootDir, 'skills', 'shared', 'ggb-basics.md')),
    body,
  ].join('\n\n').trim();
  return {
    text,
    metadata: {
      category,
      skill: CATEGORY_TO_SKILL[category],
      cards: names,
      characters: text.length,
    },
  };
}

/** 全库写法卡清单条目（不带流程步骤号，不按类别裁剪）。 */
export interface SopIndexEntry {
  name: string;
  title: string;
  inputs: string;
}

/**
 * 全库写法卡清单——**18 张全给，不按类别裁剪**。
 * 自由画图走这条：agent 看清单挑卡即可，不必先声明题目类别。
 * 做题另走 buildCatalog（带流程步骤号、只列本类引用的卡）。
 */
export function buildCardIndex(rootDir: string): SopIndexEntry[] {
  return fs.readdirSync(path.join(rootDir, 'skills', 'shared', 'sops'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort()
    .map((name) => ({ name, ...readCardMeta(rootDir, name) }));
}

/**
 * 自由画图的基础包：公共约定 + 通用 GGB 写法，**不含专家建模流程**。
 *
 * 产品定位是 agent 驱动的 GeoGebra 画图工作台；题图→GGB 只是其中一条链路，
 * 那条链路才需要 A/B/C/D 的 8 步方法论（assembleSkill）。平时 chat 画图，
 * 模型自身能力 + 本包 + 写法卡就够。
 */
export function assembleDrawingPack(rootDir: string): { text: string; characters: number } {
  const text = [
    read(path.join(rootDir, 'skills', 'shared', 'generation-rules.md')),
    read(path.join(rootDir, 'skills', 'shared', 'ggb-basics.md')),
  ].join('\n\n').trim();
  return { text, characters: text.length };
}

/** 该类的写法卡清单（名字 + 一句话说明 + 适用输入 + 所属步骤）。 */
export function buildCatalog(category: string, rootDir: string): SopCatalogEntry[] {
  const skillRaw = stripFrontmatter(read(skillPath(rootDir, category)));
  const names = sopNames(skillRaw, category);
  const stepOf = new Map<string, string>();
  for (const block of skillRaw.matchAll(new RegExp(STEP_BLOCK.source, 'gms'))) {
    for (const ref of block[0].matchAll(new RegExp(SOP_REFERENCE.source, 'gm'))) {
      if (!stepOf.has(ref[1])) stepOf.set(ref[1], block[1]);
    }
  }
  return names.map((name) => ({ name, step: stepOf.get(name) ?? '', ...readCardMeta(rootDir, name) }));
}

/**
 * 批量取写法卡（模型看清单自己挑）。未知名不抛错——报回来让模型改名重试，
 * 并附上相近名提示（少一轮猜）。
 */
export function loadSopCards(
  names: string[],
  rootDir: string,
): { cards: { name: string; text: string }[]; unknown: string[]; suggestions: string[] } {
  const all = fs.readdirSync(path.join(rootDir, 'skills', 'shared', 'sops'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
  const cards: { name: string; text: string }[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (!/^[a-z0-9-]+$/.test(name) || !all.includes(name)) {
      unknown.push(name);
      continue;
    }
    cards.push({ name, text: read(sopCardPath(rootDir, name, '?')) });
  }
  const suggestions = unknown
    .map((u) => all.filter((n) => n.includes(u) || u.includes(n)).slice(0, 3))
    .flat()
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .slice(0, 5);
  return { cards, unknown, suggestions };
}

/**
 * app.py:build_allowed_commands_suffix 的移植——
 * 与解析白名单同源的"严格语法约束"prompt 尾巴。
 */
/**
 * 命令约束后缀（与校验白名单同源）。
 *
 * `category` 决定列 2D 还是 2D+3D：A/B/C 只做二维故只列 2D，D 类给全。
 * **不给类别时两种都列**——自由画图可能是二维也可能是三维，不该按做题分类裁剪。
 */
export function buildAllowedCommandsSuffix(category: string | undefined, names: WhitelistNames): string {
  const views: Array<'2d' | '3d'> = category && category !== 'D' ? ['2d'] : ['2d', '3d'];
  const ctorLines: string[] = [];
  for (const v of views) {
    const cmds = names[v];
    if (cmds.length) {
      ctorLines.push(`- ${v === '3d' ? '3D ' : ''}构造命令: ${cmds.join(', ')}`);
    }
  }
  return (
    '\n### 严格语法约束（系统自动生成，与校验白名单同源）\n' +
    ctorLines.join('\n') +
    `\n- 属性命令: ${names.attributes.join(', ')}` +
    `\n- 视图命令: ${names.globals.join(', ')}` +
    '\n- 仅可使用以上命令，不要使用任何其他命令，不要输出注释或说明文字。' +
    '\n- 上述为输入栏命令，不是 JavaScript API。坐轴/网格用 ShowAxes/ShowGrid；' +
    '标签模式用 SetLabelMode，平行平面用 Plane(点,平面)。' +
    '命令重载按对象类型选择，不能把函数当圆锥曲线或把点当数值。\n'
  );
}
