/**
 * GGB 重放体检：生成指令回放后全量核对对象建立情况。
 *
 * 背景（case-01 事故）：未定义点是"假成功"——evalCommand 返回 true 且对象名存在，
 * 但值是 (?,?)（如 E = (Root(f, 2, 4), 0) 把点包成坐标），下游 l=Line(E,M) 等连坐静默失败。
 * 旧检测只看"两次重放都返回 false 的行 + 对象名缺失"，4 个破损对象只报了 2 个。
 *
 * 体检规则（对每条定义行）：
 *   缺失   —— 期望名（含 Root(f) 自动命名变体 name_1/name_2）全部不存在
 *   未定义 —— 对象存在，但值字符串带未定义标记（?/undefined/未定义）
 * 无条件全量体检（不再只在部分命令失败时才查）。
 */

export interface GgbProbeApi {
  getAllObjectNames: () => string[];
  getValueString?: (name: string) => string;
  getObjectType?: (name: string) => string;
}

export interface AuditFinding {
  kind: "missing" | "undefined";
  name: string;
  line: string;
}

export interface AuditResult {
  findings: AuditFinding[];
  missing: AuditFinding[];
  undefinedObjs: AuditFinding[];
  degraded: boolean; // true = getValueString 不可用，未定义检测被跳过
}

/** 定义行：`E = ...`、`f(x) = ...`、`A := ...`；属性行/SetXxx/MODE 不匹配。 */
const DEF_LINE = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*:?=/;

/** 未定义值的显示标记（多标记容错：英文/本地化/点坐标形态）。 */
const UNDEFINED_MARKERS = /\?|undefined/i;

export function auditConstruction(api: GgbProbeApi, commands: string[]): AuditResult {
  const names = new Set(api.getAllObjectNames() as string[]);
  const missing: AuditFinding[] = [];
  const undefinedObjs: AuditFinding[] = [];
  const canProbeValues = typeof api.getValueString === "function";
  const seen = new Set<string>();

  for (const raw of commands) {
    const line = raw.trim();
    const m = line.match(DEF_LINE);
    if (!m) continue;
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);

    // Root(f) 会自动命名 n_1/n_2 等变体——任一变体存在即视为已建立
    const variants = [name, `${name}_1`, `${name}_2`].filter((n) => names.has(n));
    if (variants.length === 0) {
      missing.push({ kind: "missing", name, line });
      continue;
    }
    if (!canProbeValues) continue;

    for (const v of variants) {
      try {
        if (api.getObjectType?.(v) === "text") continue; // 文字对象值含 ? 不算未定义
        const value = api.getValueString!(v) ?? "";
        if (UNDEFINED_MARKERS.test(value)) {
          undefinedObjs.push({ kind: "undefined", name: v, line });
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
