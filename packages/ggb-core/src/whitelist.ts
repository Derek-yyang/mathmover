/**
 * 命令白名单（单一事实来源：仓库根 ggb_commands.json，与 Python 侧共享）。
 *
 * 对拍目标是 ggb_parser.whitelist_command_names() 的输出语义：
 * { 2d, 3d, attributes, globals } —— 每项是按小写排序后的**规范显示名**列表。
 * （JSON 里已是视图→名字列表；aliases 把旧名映射到规范名。）
 */

import fs from 'node:fs';
import path from 'node:path';

export interface WhitelistNames {
  '2d': string[];
  '3d': string[];
  attributes: string[];
  globals: string[];
}

interface RawCatalog {
  constructors: Record<string, string[]>;
  attributes: string[];
  globals: string[];
  aliases?: Record<string, string>;
  expression_functions?: string[] | Record<string, unknown>;
}

export interface Whitelist {
  names: WhitelistNames;
  /** 全部合法命令名（小写），含别名——供"未知命令"检查 */
  knownLower: Set<string>;
}

let cache: { root: string; value: Whitelist } | null = null;

function loadRaw(rootDir: string): RawCatalog {
  const file = path.join(rootDir, 'ggb_commands.json');
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as RawCatalog;
}

/** 规范显示名：别名映射到目标（目标可能再无别名，一步即止，与 aliases 单层语义一致）。 */
function canonical(display: string, aliases: Record<string, string>): string {
  return aliases[display] ?? display;
}

export function loadWhitelist(rootDir: string): Whitelist {
  if (cache && cache.root === rootDir) return cache.value;
  const raw = loadRaw(rootDir);
  const aliases = raw.aliases ?? {};

  // Python 语义：名字按小写排序，输出规范显示名；2d 含"仅 3d 之外的全部"
  const dedupeSort = (names: string[]): string[] => {
    const byLower = new Map<string, string>();
    for (const n of names) {
      const c = canonical(n, aliases);
      const low = c.toLowerCase();
      if (!byLower.has(low)) byLower.set(low, c);
    }
    return [...byLower.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, v]) => v);
  };

  const only3d = new Set(
    (raw.constructors['3d'] ?? []).filter((n) => !(raw.constructors['2d'] ?? []).includes(n)),
  );
  const names: WhitelistNames = {
    '2d': dedupeSort((raw.constructors['2d'] ?? []).filter((n) => !only3d.has(n))),
    '3d': dedupeSort([...(raw.constructors['3d'] ?? []), ...only3d]),
    attributes: dedupeSort(raw.attributes ?? []),
    globals: dedupeSort(raw.globals ?? []),
  };

  const knownLower = new Set<string>();
  for (const list of [names['2d'], names['3d'], names.attributes, names.globals]) {
    for (const n of list) knownLower.add(n.toLowerCase());
  }
  for (const [from, to] of Object.entries(aliases)) {
    knownLower.add(from.toLowerCase());
    knownLower.add(to.toLowerCase());
  }
  const exprFns = raw.expression_functions;
  if (Array.isArray(exprFns)) for (const n of exprFns) knownLower.add(String(n).toLowerCase());
  else if (exprFns && typeof exprFns === 'object') {
    for (const n of Object.keys(exprFns)) knownLower.add(n.toLowerCase());
  }

  const value: Whitelist = { names, knownLower };
  cache = { root: rootDir, value };
  return value;
}
