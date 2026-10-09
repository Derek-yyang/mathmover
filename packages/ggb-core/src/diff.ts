/**
 * 指令清单 diff —— 用于「说清改了什么」。
 *
 * 为什么要有它：现在助手气泡是写死字符串「已根据你的要求调整几何构造！」，
 * 完全没信息量。而新旧两份 commands[] 的 diff 就是**精确**的改动描述，
 * 零模型成本、必对、可直接转述给用户。
 *
 * 设计取舍：
 *  - 按**对象名**对齐（不是逐行位置）——重新生成的清单顺序会变，按行号比会全是噪音。
 *  - 无名行（SetColor / ShowLabel 等属性行）归到它修饰的对象名下；解析不出就用行文本作键。
 *  - 保留 before/after 原文，便于 agent 引用给用户看。
 */

import type { DiffEntry, DiffResult, GgbCommand } from './types.ts';
import { parseCommands } from './parse.ts';

/** 从属性行猜它修饰的对象名，如 `SetColor(f, "#FF0000")` → f */
const PROP_TARGET = /^\s*(?:Set\w+|Show\w+|SetTooltip|SetColor|SetFilling|SetLineThickness|SetPointStyle)\s*\(\s*([A-Za-z][A-Za-z0-9_]*)/;

function keyOf(cmd: GgbCommand): string {
  if (cmd.name) return cmd.name;
  const m = cmd.raw.match(PROP_TARGET);
  if (m) return m[1];
  return `@line:${cmd.raw.trim()}`;
}

/**
 * 比较两份指令清单。
 *
 * @param before 旧清单（改动前的账本）
 * @param after  新清单（改动后的账本）
 */
export function diffCommands(before: string[], after: string[]): DiffResult {
  const beforeMap = new Map<string, GgbCommand[]>();
  const afterMap = new Map<string, GgbCommand[]>();

  for (const c of parseCommands(before).commands) {
    if (c.kind === 'blank' || c.kind === 'comment' || c.kind === 'mode') continue;
    const k = keyOf(c);
    if (!beforeMap.has(k)) beforeMap.set(k, []);
    beforeMap.get(k)!.push(c);
  }
  for (const c of parseCommands(after).commands) {
    if (c.kind === 'blank' || c.kind === 'comment' || c.kind === 'mode') continue;
    const k = keyOf(c);
    if (!afterMap.has(k)) afterMap.set(k, []);
    afterMap.get(k)!.push(c);
  }

  const entries: DiffEntry[] = [];
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  let unchanged = 0;

  for (const k of keys) {
    const b = (beforeMap.get(k) || []).map((c) => c.raw.trim());
    const a = (afterMap.get(k) || []).map((c) => c.raw.trim());
    const bText = b.join(' | ');
    const aText = a.join(' | ');

    if (bText === aText) {
      if (b.length > 0) unchanged += b.length;
      continue;
    }
    if (b.length === 0) {
      entries.push({ op: 'added', name: k.startsWith('@line:') ? null : k, before: null, after: aText });
    } else if (a.length === 0) {
      entries.push({ op: 'removed', name: k.startsWith('@line:') ? null : k, before: bText, after: null });
    } else {
      entries.push({ op: 'changed', name: k.startsWith('@line:') ? null : k, before: bText, after: aText });
    }
  }

  // 稳定排序：新增在前、修改居中、删除在后，组内按名称
  const order = { added: 0, changed: 1, removed: 2 } as const;
  entries.sort((x, y) => order[x.op] - order[y.op] || String(x.name).localeCompare(String(y.name)));

  return {
    entries,
    summary: summarize(entries),
    unchangedCount: unchanged,
  };
}

const OP_LABEL = { added: '新增', changed: '修改', removed: '删除' } as const;

/**
 * 一句话中文摘要。刻意保守：只陈述事实，不解读几何意图
 * （那是模型的活，工具不该编故事）。
 */
function summarize(entries: DiffEntry[]): string {
  if (entries.length === 0) return '与上一版完全相同，未作改动。';

  const groups = new Map<string, string[]>();
  for (const e of entries) {
    const label = e.name ?? '无名指令';
    if (!groups.has(e.op)) groups.set(e.op, []);
    groups.get(e.op)!.push(label);
  }

  const parts: string[] = [];
  for (const op of ['added', 'changed', 'removed'] as const) {
    const names = groups.get(op);
    if (!names || names.length === 0) continue;
    const shown = names.slice(0, 6).join('、');
    const more = names.length > 6 ? ` 等 ${names.length} 项` : '';
    parts.push(`${OP_LABEL[op]} ${shown}${more}`);
  }

  const total = entries.length;
  return `共 ${total} 处改动：${parts.join('；')}。`;
}
