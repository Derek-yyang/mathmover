/**
 * GGB 指令行解析 —— 把清单拆成可分析的结构。
 *
 * 与现行 Python `ggb_parser.py` 的关系：
 *  本模块按**正确语义**实现（`A := (0,0)` 归为 colon-def）。
 *  现行 Python 的 DEF_LINE 会把冒号定义误判成 equation——已知缺陷。
 *  由于 golden 基线锁的是 **prompt 装配文本**（不是解析），此处不必复刻该缺陷；
 *  若将来要求与 Python 逐字节对拍解析结果，需先修 Python 再同步 golden。
 *
 * 关键约定：
 *  - `raw` 保留原样（diff 与回放都要它）
 *  - `text` 是送入 evalCommand 的形态（反转义 \"、去首尾空白）
 *  - **绝不以 evalCommand 返回值当唯一成功判据**——case-01「假成功」教训，
 *    正确性由无条件全量体检保证，解析层只负责分类。
 */

import type { GgbCommand, Mode, ParsedCommands } from './types.ts';

/** 定义行：`E = ...`、`f(x) = ...`、`A := ...`。属性行/SetXxx/MODE 不匹配。 */
const DEF_LINE = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*(:?=)/;

const MODE_LINE = /^\s*MODE\s*:/i;
const COMMENT_LINE = /^\s*\/\//;

/** 归一化送入 evalCommand 的文本：反转义 GeoGebra 的 \" 序列 */
export function normalizeCommandText(raw: string): string {
  return raw.replace(/\\"/g, '"').trim();
}

/**
 * 属性行解析：命令头 + 目标对象名。
 * 例：`SetColor(f, "#FF0000")` → `{ head: 'SetColor', target: 'f' }`
 *
 * 命令头集合与 PROP_LINE 一致（含 SetCaption/SetVisible/SetTrace）；
 * diff.ts 的 PROP_TARGET 与它是同源语义，改这里两边都对。
 */
const PROP_HEAD_TARGET =
  /^\s*(Set\w+|Show\w+|SetTooltip|SetColor|SetFilling|SetLineThickness|SetPointStyle|SetCaption|SetVisible|SetTrace)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)/;

export function parsePropertyLine(raw: string): { head: string; target: string } | null {
  const m = PROP_HEAD_TARGET.exec(raw.trim());
  if (!m) return null;
  return { head: m[1], target: m[2] };
}

/**
 * 属性行判定 —— **假失败陷阱的公共判据**。
 * `evalCommand('SetColor(...)')` 成功也返回 false（case-01 教训），
 * 判成败必须走这里，不能看返回值。
 */
export function isPropertyLine(raw: string): boolean {
  return parsePropertyLine(raw) !== null;
}

export function classifyLine(raw: string): { kind: GgbCommand['kind']; name: string | null } {
  const line = raw.trim();
  if (!line) return { kind: 'blank', name: null };
  if (COMMENT_LINE.test(line)) return { kind: 'comment', name: null };
  if (MODE_LINE.test(line)) return { kind: 'mode', name: null };

  const def = line.match(DEF_LINE);
  if (def) {
    return { kind: def[2] === ':=' ? 'colon-def' : 'definition', name: def[1] };
  }
  const prop = parsePropertyLine(line);
  if (prop) {
    return { kind: 'property', name: prop.target };
  }
  return { kind: 'unknown', name: null };
}

/**
 * 解析整份清单。
 *
 * @param lines 原始清单（可含空行、注释、MODE: 行）
 */
export function parseCommands(lines: string[]): ParsedCommands {
  const commands: GgbCommand[] = [];

  lines.forEach((raw, index) => {
    const { kind, name } = classifyLine(raw);
    commands.push({
      raw,
      text: normalizeCommandText(raw),
      index,
      kind,
      name,
    });
  });

  const isDroppable = (c: GgbCommand) =>
    c.kind === 'blank' || c.kind === 'comment' || c.kind === 'mode';

  const executable = commands.filter((c) => !isDroppable(c) && c.text.length > 0);
  const dropped = commands.filter(isDroppable);

  return {
    commands,
    executable,
    dropped,
    mode: detectMode(commands),
  };
}

/**
 * 模式判定：入参缺省 2D；`MODE:3D` 覆盖。
 * 与 useGgbSession.executeCommands 的语义对齐：
 *   MODE: 行含 '3D' → '3D'，否则 '2D'。
 */
export function detectMode(commands: GgbCommand[]): Mode {
  for (const c of commands) {
    if (c.kind === 'mode' && /3d/i.test(c.raw)) return '3D';
    if (c.kind === 'mode') return '2D';
  }
  return '2D';
}
