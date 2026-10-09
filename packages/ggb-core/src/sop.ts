/**
 * 专家 prompt 拼装（expert_prompts.py 的 TS 移植，语义对拍）。
 *
 * 组装规则（锁定于 prompt-goldens.json，改这里必须过金测试）：
 *   text = generation-rules.md + "\n\n" + skill(去 frontmatter、{{SOP:...}} 换成卡片)
 *   卡片标题降级：每卡首个行首 "# " → "### "（嵌进编号步骤之下）
 *   校验：SOP 引用必须独占一行、不重复、且都在编号步骤（## N.）内；卡内不得再嵌 {{SOP
 * 缓存键按金测试设计用**文件内容 sha256**（不是 mtime）。
 *
 * buildAllowedCommandsSuffix 是 app.py 同名函数的移植（不在金测试内，忠实转写）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
 * Python 文本模式的读法（universal newlines：\r\n → \n），再 rstrip。
 * 卡片在 Windows 检出可能是 CRLF——不归一会让字符数与哈希全盘偏离金基线。
 */
function read(file: string): string {
  return fs.readFileSync(file, 'utf-8').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

/** 生成器 files[].sha256 的口径：LF 归一的全文（含尾部空白，不 rstrip）。 */
function readNormalized(file: string): string {
  return fs.readFileSync(file, 'utf-8').replace(/\r\n?/g, '\n');
}

export interface PromptAssembly {
  text: string;
  metadata: {
    mode: 'full';
    cards: string[];
    characters: number;
    skill_characters: number;
    sop_characters: number;
  };
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

export function assembleExpertPrompt(category: string, rootDir: string): PromptAssembly {
  const skill = stripFrontmatter(read(skillPath(rootDir, category)));
  const names = sopNames(skill, category);
  const cards = new Map<string, string>();
  for (const name of names) cards.set(name, read(sopCardPath(rootDir, name, category)));
  for (const card of cards.values()) {
    if (card.includes('{{SOP')) {
      throw new SopAssemblyError('SOP 卡含嵌套引用；所需写法应在 skill 中直接引用');
    }
  }

  const inline = skill.replace(new RegExp(SOP_REFERENCE.source, 'gm'), (_m, name: string) =>
    // 每卡首个行首 H1 降为 H3（嵌进步骤之下；示例代码原样保留）
    cards.get(name)!.replace(/^# /, '### '),
  ).trim();
  const text = read(path.join(rootDir, 'skills', 'shared', 'generation-rules.md')) + '\n\n' + inline;

  return {
    text,
    metadata: {
      mode: 'full',
      cards: names,
      characters: text.length,
      skill_characters: skill.replace(new RegExp(SOP_REFERENCE.source, 'gm'), '').length,
      sop_characters: [...cards.values()].reduce((n, c) => n + c.length, 0),
    },
  };
}

/** 参与拼装的全部文件 + 内容哈希（金测试同款字段；作缓存失效键）。 */
export function participatingFiles(
  category: string,
  rootDir: string,
): { path: string; sha256: string }[] {
  const skillFile = skillPath(rootDir, category);
  const skill = stripFrontmatter(read(skillFile));
  const names = sopNames(skill, category);
  const files = [
    skillFile,
    path.join(rootDir, 'skills', 'shared', 'generation-rules.md'),
    ...names.map((n) => sopCardPath(rootDir, n, category)),
  ];
  return files.map((f) => ({
    path: path.relative(rootDir, f).replace(/\\/g, '/'),
    sha256: sha256Utf8(readNormalized(f)),
  }));
}

export function sha256Utf8(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/**
 * app.py:build_allowed_commands_suffix 的移植——
 * 与解析白名单同源的"严格语法约束"prompt 尾巴。
 */
export function buildAllowedCommandsSuffix(category: string, names: WhitelistNames): string {
  const views: Array<'2d' | '3d'> = category === 'D' ? ['2d', '3d'] : ['2d'];
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

export function expertPromptWithSuffix(category: string, rootDir: string): PromptAssembly {
  const assembly = assembleExpertPrompt(category, rootDir);
  const suffix = buildAllowedCommandsSuffix(category, loadWhitelist(rootDir).names);
  return {
    ...assembly,
    text: assembly.text + suffix,
    metadata: { ...assembly.metadata, characters: assembly.text.length + suffix.length },
  };
}
