/**
 * 从 GGB api 实例探测状态 —— 「手」的可复用核心。
 *
 * 为什么不放在 React hook 或执行器里：同一份逻辑要被
 *   ① 网页里的活画布（math-mover-next/lib/ggb-bridge）
 *   ② 将来的无头执行器 / Electron 隐藏窗口
 * 共用。这里只认一个最小 api 面，不认宿主。
 *
 * ── 体检为什么必须无条件全量 ────────────────────────────────
 * case-01「假成功」：evalCommand 返回 true、对象名也存在，但值是 (?,?)
 * （`E = (Root(f,2,4), 0)` 把点包成了坐标），下游 `l = Line(E,M)` 连坐静默失败。
 * 所以**绝不以 evalCommand 返回值当唯一成功判据**，必须逐对象查值。
 * ───────────────────────────────────────────────────────────
 */

import type {
  AuditFinding,
  AuditResult,
  ObjectSummary,
  SliderState,
} from './types.ts';

/** 体检所需的最小 api 面（可被真实 applet 或测试替身满足）。 */
export interface GgbProbeApi {
  getAllObjectNames: () => string[];
  getObjectType: (name: string) => string;
  getValueString?: (name: string) => string;
  getValue?: (name: string) => number;
  isIndependent?: (name: string) => boolean;
  getMin?: (name: string) => number;
  getMax?: (name: string) => number;
  getStep?: (name: string) => number;
}

/** 定义行：`E = ...`、`f(x) = ...`、`A := ...`；属性行/SetXxx/MODE 不匹配。 */
const DEF_LINE = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*:?=/;

/** 未定义值的显示标记（英文/本地化/点坐标形态）。 */
const UNDEFINED_MARKERS = /\?|undefined/i;

/** 文字对象的值天然含 ? 之类字符，不算未定义。 */
const TEXT_TYPE = 'text';

const DEFAULT_SLIDER_RANGE = { min: -10, max: 10, step: 0.1 } as const;

/** 提取一行里的期望对象名（定义行才有）。 */
export function expectedNameOf(line: string): string | null {
  const m = line.trim().match(DEF_LINE);
  return m ? m[1] : null;
}

/**
 * 无条件全量体检。
 *
 * @param api  GGB api（或测试替身）
 * @param lines 已提交的清单（账本原样，含注释/空行——它们会被跳过）
 */
export function auditConstruction(api: GgbProbeApi, lines: string[]): AuditResult {
  const names = new Set(api.getAllObjectNames() as string[]);
  const missing: AuditFinding[] = [];
  const undefinedObjs: AuditFinding[] = [];
  const canProbeValues = typeof api.getValueString === 'function';
  const seen = new Set<string>();

  for (const raw of lines) {
    const name = expectedNameOf(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);

    // Root(f) 会自动命名 n_1/n_2 变体——任一变体存在即视为已建立
    const variants = [name, `${name}_1`, `${name}_2`].filter((n) => names.has(n));
    if (variants.length === 0) {
      missing.push({ kind: 'missing', name, line: raw.trim() });
      continue;
    }
    if (!canProbeValues) continue;

    for (const v of variants) {
      try {
        if (api.getObjectType?.(v) === TEXT_TYPE) continue;
        const value = api.getValueString!(v) ?? '';
        if (UNDEFINED_MARKERS.test(value)) {
          undefinedObjs.push({ kind: 'undefined', name: v, line: raw.trim() });
        }
      } catch {
        // 单个对象探测异常不影响整体体检
      }
    }
  }

  return {
    findings: [...missing, ...undefinedObjs],
    missing,
    undefinedObjs,
    degraded: !canProbeValues,
  };
}

/** 现场探测对象清单——模型感知的核心通道之一。 */
export function summarizeObjects(api: GgbProbeApi): ObjectSummary[] {
  const out: ObjectSummary[] = [];
  let names: string[] = [];
  try {
    names = api.getAllObjectNames() || [];
  } catch {
    return out;
  }

  for (const name of names) {
    let type = '?';
    try {
      type = api.getObjectType(name);
    } catch {}
    let value: string | null = null;
    try {
      value = typeof api.getValueString === 'function' ? api.getValueString(name) : null;
    } catch {}
    let independent = false;
    try {
      independent = typeof api.isIndependent === 'function' ? api.isIndependent(name) : false;
    } catch {}
    out.push({ name, type, value, independent });
  }
  return out;
}

/**
 * 滑块/自由数值对象状态。
 *
 * 2026-10-09 spike 实测：classic applet **没有** getMin/getMax/getStep，
 * 所以范围只能用缺省值并置 rangeIsDefault，避免误导模型以为那是真实范围。
 */
export function detectSliders(api: GgbProbeApi): SliderState[] {
  const out: SliderState[] = [];
  let names: string[] = [];
  try {
    names = api.getAllObjectNames() || [];
  } catch {
    return out;
  }

  for (const name of names) {
    try {
      if (api.getObjectType(name) !== 'numeric') continue;
      if (typeof api.isIndependent === 'function' && !api.isIndependent(name)) continue;

      const value = typeof api.getValue === 'function' ? api.getValue(name) : Number.NaN;
      const hasRange = typeof api.getMin === 'function';
      out.push({
        name,
        value,
        min: hasRange ? api.getMin!(name) : DEFAULT_SLIDER_RANGE.min,
        max: hasRange ? api.getMax!(name) : DEFAULT_SLIDER_RANGE.max,
        step: hasRange ? api.getStep!(name) : DEFAULT_SLIDER_RANGE.step,
        rangeIsDefault: !hasRange,
      });
    } catch {
      // 单个滑块探测异常不影响整体
    }
  }
  return out;
}
