/**
 * MathMover 领域核心类型 —— 唯一真源。
 *
 * 被 ggb-executor / MCP 工具层 / 评测脚本共同依赖。
 * 吸收了 math-mover-next/components/dashboard/types.ts 与 lib/ggb-audit.ts 的双份定义
 * （那份是 React 侧的副本，前端收敛后应改从这里取）。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 三条已裁定的不变量（2026-10-09 作者拍板），改动前请先想清楚：
 *
 *  1. 【真源唯一】`commands: GgbCommand[]` 是唯一权威状态。
 *     objects / sliders / png / audit 全是**派生视图**，随时可从执行器重算，
 *     不持久化（尤其不要塞 localStorage —— 会爆配额也会脏）。
 *     会话崩溃恢复 = 用账本全量重放，不需要快照。
 *
 *  2. 【读写不对称】
 *     写（模型产出）只用一种格式：**全量 GGB 指令清单**。
 *         可机械验证、可回放、可 diff。不做增量 patch 协议。
 *     读（模型感知）用多元通道：结构摘要 + 画布 PNG + 上轮 audit。
 *         光有 commands 文本不足以回答"那条红色虚线是哪条"。
 *
 *  3. 【校验不拦路】`submit_construction` 收到无效行时**剔除后照常下发**，
 *     只把明细回传给 agent，由它自行决定改不改。
 *     与现行 app.py:1018-1024 / ggb_parser「宁可放过」一致；
 *     单行笔误不得卡死整题提交。质量门用 options.strict，仅供离线评测。
 * ────────────────────────────────────────────────────────────────────────
 */

/** 画板模式。MODE: 指令可覆盖；缺省 2D。 */
export type Mode = '2D' | '3D';

/**
 * 学科类别，决定用哪份专家 prompt 与 semantic_check 的结构判据。
 * A 函数 / B 平面几何 / C 圆锥曲线 / D 立体几何
 */
export type Category = 'A' | 'B' | 'C' | 'D';

export const CATEGORY_LABELS: Record<Category, string> = {
  A: '函数',
  B: '平面几何',
  C: '圆锥曲线',
  D: '立体几何',
};

/** 解析后的一条 GGB 指令。 */
export interface GgbCommand {
  /** 原始行文本（保留原样，用于 diff 与回放） */
  raw: string;
  /** 归一化后将送入 evalCommand 的文本（反转义 \" → "，去首尾空白） */
  text: string;
  /** 该行在来源清单中的 0 基序号，用于 stable diff */
  index: number;
  kind: CommandKind;
  /** 定义行的目标对象名；非定义行为 null */
  name: string | null;
}

/**
 * 指令行种类。注意 COLON_DEF 覆盖 `A := (0,0)` 这类冒号定义——
 * 现行 Python 的 DEF_LINE 正则把它误判成 equation，已知缺陷，
 * 本轮 golden 锁旧行为，修复另立变更（见 prompt-goldens.json 的 notes）。
 */
export type CommandKind =
  | 'definition'   // E = ... / f(x) = ...
  | 'colon-def'    // A := ...
  | 'property'     // SetColor / SetLineThickness / ShowLabel ...
  | 'mode'         // MODE:2D / MODE:3D
  | 'comment'      // // ...
  | 'blank'
  | 'unknown';

/** 解析整份清单的结果。 */
export interface ParsedCommands {
  commands: GgbCommand[];
  /** 可执行行（已剔除 blank/comment/mode） */
  executable: GgbCommand[];
  /** 会被剔除、不下发的行（含空白/注释/非法） */
  dropped: GgbCommand[];
  mode: Mode;
}

/** 体检发现。对应 ggb-audit.ts 的 AuditFinding。 */
export interface AuditFinding {
  kind: 'missing' | 'undefined';
  name: string;
  line: string;
}

/**
 * 无条件全量体检结果。
 * 为什么必须无条件全量：case-01「假成功」——evalCommand 返回 true 且对象名存在，
 * 但值是 (?,?)（如 `E = (Root(f,2,4), 0)` 把点包成坐标），下游连坐静默失败。
 * 绝不以 evalCommand 返回值当唯一成功判据。
 */
export interface AuditResult {
  findings: AuditFinding[];
  missing: AuditFinding[];
  undefinedObjs: AuditFinding[];
  /** true = getValueString 不可用，未定义检测被跳过 */
  degraded: boolean;
}

/** 滑块/自由数值对象的当前状态。 */
export interface SliderState {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  isAnimating?: boolean;
  /**
   * min/max/step 是否为缺省值（-10/10/0.1）而非 applet 实际范围。
   *
   * 2026-10-09 spike 实测：classic applet **没有** `getMin` / `getMax` / `getStep`。
   * 所以范围只能是缺省值，或由模型在生成指令时显式给（如 `slider_t = 2` 的
   * 滑块创建语法带范围）。此标志恒应为 true，留字段以便将来 applet 版本变化时扩展。
   */
  rangeIsDefault?: boolean;
}

/** 画板上一个对象的结构摘要条目——模型感知的核心通道之一。 */
export interface ObjectSummary {
  name: string;
  type: string;               // point / line / function / numeric / text / ...
  /** getValueString 结果；未定义对象会含 ? / undefined 标记 */
  value: string | null;
  /** 是否自由对象（可拖动） */
  independent: boolean;
}

/**
 * PNG 通道来源，用于回归比对与降级诊断。
 *
 * 2026-10-09 spike 实测（headless Chrome + swiftshader，见 scripts/spike-ggb-png.mjs）：
 *   - `applet-export`：**不存在**。classic applet 的 api 面没有 `exportPNG`
 *     （计划原文设想的主通道是错的，已证伪）。
 *   - `host-screenshot`：**唯一可用通道，且渲染完全正确**（线/点/标签/曲线颜色
 *     与用户所见同源同帧）。这是主通道，不是兜底。
 *   - `get-base64`：**不是图片通道**。getBase64() 返回 GeoGebra 构造数据
 *     （base64 的 .ggb），用 setBase64() 回灌；解图会失败。
 *
 * 结论：PNG 感知契约守住，但走宿主截屏。适配器抽象（page.screenshot /
 * webContents.capturePage）因此成为**正式通道**而非降级路径。
 */
export type PngSource = 'canvas-to-data-url' | 'host-screenshot' | 'applet-export' | 'get-base64';

export interface PngResult {
  /** dataURL 的 base64 段（不含 `data:image/png;base64,` 前缀） */
  base64: string | null;
  source: PngSource | null;
  width: number | null;
  height: number | null;
  /**
   * 是否非空白。软渲染下 canvas 合成失败会出全白/全黑图，
   * 用采样像素方差判定；false 必须降级，绝不静默给模型一张白图。
   */
  nonBlank: boolean | null;
  degradedReason?: string;
}

/**
 * 一次 `ggb_get_state` 的完整返回 —— **多元感知通道**。
 *
 * 用法约定：`commands` 是真源（账本原样 echo，不重跑 parse，保证幂等）；
 * 其余都是从执行器现场重算的派生视图。
 */
export interface BoardState {
  /** 真源：当前已提交的全量指令清单（账本原样） */
  commands: string[];
  /** 派生：对象结构摘要 */
  objects: ObjectSummary[];
  /** 派生：滑块状态 */
  sliders: SliderState[];
  /** 派生：画布截图 */
  png: PngResult;
  /** 派生：对当前账本的体检 */
  audit: AuditResult;
  mode: Mode;
  /** 账本代数，每次全量替换 +1；用于判断状态是否已变 */
  generation: number;
  /** 本次调用是否出现降级；明细见 degradedReasons */
  degraded: boolean;
  degradedReasons: string[];
}

/** 两次账本之间的语义化差异——用于"说清改了什么"，零成本且必对。 */
export interface DiffEntry {
  op: 'added' | 'removed' | 'changed';
  /** 对象名；属性行等无名行归入其所属对象或用行文本作键 */
  name: string | null;
  before: string | null;
  after: string | null;
}

export interface DiffResult {
  entries: DiffEntry[];
  /** 一句话中文摘要，供 agent 直接转述给用户 */
  summary: string;
  unchangedCount: number;
}

/** `submit_construction` 的校验明细。**不拦路**，只回传。 */
export interface ValidationDetail {
  check: string;
  detail: string;
}

export interface SubmitValidation {
  /** semantic_check 通过与否。false 不影响下发（见不变量 3） */
  semanticOk: boolean;
  /** 因无效而被剔除、未下发的行 */
  invalidLines: string[];
  /** 语义校验失败明细（含 check 名 + detail） */
  semanticFailures: ValidationDetail[];
  /** 用于离线评测的质量门；产品链路恒为 false */
  strict: boolean;
  /** 剔除后实际下发的行 */
  delivered: string[];
}

/** 执行器回放一条指令的单次尝试结果。 */
export interface ApplyResult {
  applied: string[];
  /** 第一遍失败、300ms 后补漏的行 */
  failedFirstPass: string[];
  durationMs: number;
  audit: AuditResult;
  degraded: boolean;
  degradedReasons: string[];
}

/**
 * 执行器宿主接缝 —— **这是冻结的边界**。
 * 今天 = Playwright 驱 headless Chromium；明天 = Electron 隐藏 BrowserWindow。
 * 迁移只换实现，工具签名永远看不到传输层。
 */
export interface GgbExecutor {
  readonly id: 'playwright' | 'electron' | 'web';
  init(opts: { mode: Mode }): Promise<void>;
  /** 全量覆盖：清空画板后重放。`commands` 为新的账本内容。 */
  apply(commands: string[], opts?: { mode?: Mode }): Promise<ApplyResult>;
  getState(opts: { png?: boolean; pngMaxEdge?: number }): Promise<BoardState>;
  reset(): Promise<void>;
  /** 健康探针。注意：探针对象用后必须 Delete，否则污染 getAllObjectNames/滑块探测 */
  ping(): Promise<boolean>;
  dispose(): Promise<void>;
}

/** 执行器不可用时的错误码。 */
export const GGB_ERROR = {
  /** 资产不可用：离线且本地 vendoring 未命中。快速失败，不挂 1 分钟。 */
  ASSETS_UNAVAILABLE: 'GGB_ASSETS_UNAVAILABLE',
  /** applet 就绪握手超时 */
  BOOT_TIMEOUT: 'GGB_BOOT_TIMEOUT',
  /** 页面崩溃/关闭 */
  SESSION_DEAD: 'GGB_SESSION_DEAD',
} as const;
