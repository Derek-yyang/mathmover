/**
 * 能力旗标的「值拒绝探针」结果与缓存（对齐 OpenDesign 的 hiddenCapabilityFlags）。
 *
 * 原理：参数解析器对「不认识的旗标」和「认识但值不能用的旗标」报错形状不同——
 *   不认识 → "unknown option '--x'" / "unexpected argument '--x'"
 *   认识   → "Invalid session ID" / "is not a UUID" / "No prompt provided" …
 * 两者都在碰模型之前失败，探一发零 token 成本。
 *
 * 与 OpenDesign 原版规则的差异（2026-10-12 实测裁决）：
 * 他们要求报错**点名旗标**才算认识（`output.includes(flag) && !unknown-option`）。
 * 但 claude 的 `--session-id __假值__` 只报 "Invalid session ID. Must be a valid UUID."
 * ——既不点名旗标也不点名假值，原版规则会误判为「不认识」。
 * 我们的规则改为按报错**阶段**分类：
 *   - 未知旗标类措辞 → false（解析器确实拒绝了旗标）
 *   - 其他任何输出   → true（解析已越过旗标，到了值校验/缺输入等更晚阶段）
 *   - 空输出 / spawn 失败 → false（没有证据）
 * 这个方向的误判是安全的：误判「真」= 传旗标（维持今天的行为，不认识就照旧死在
 * 未知旗标上）；误判「假」= 摘旗标（降级但能跑）。所以宁可宽松。
 *
 * 只适用**带值**旗标。布尔旗标没有「值」可拒，假值会被当成 prompt 真发模型调用——
 * 那是探针的禁区，布尔旗标别往这里放。
 */

/** 任何选项都不可能接受的值：迫使 CLI 在干活前先校验旗标。 */
export const HIDDEN_FLAG_PROBE_VALUE = '__mm_capability_probe__';

/**
 * 一次探针输出 → 该旗标是否被识别。
 * 纯函数，判定规则的唯一出处；探针的 spawn 逻辑在 detect.ts。
 */
export function classifyHiddenProbeOutput(output: string): boolean {
  const text = output.trim();
  if (!text) return false;
  if (/unknown (option|argument|flag)|unrecognized (option|argument)|unexpected argument|no such option|bad option/i.test(text)) {
    return false;
  }
  return true;
}

/** 按运行时 id 缓存探针结果；detect 重探时整体覆盖。 */
const cache = new Map<string, Record<string, boolean>>();

/** 未探测过返回 undefined——调用方据此维持旧行为（旗标默认传）。 */
export function getCapabilities(id: string): Record<string, boolean> | undefined {
  return cache.get(id);
}

export function setCapabilities(id: string, caps: Record<string, boolean>): void {
  cache.set(id, caps);
}

export function clearCapabilities(): void {
  cache.clear();
}
