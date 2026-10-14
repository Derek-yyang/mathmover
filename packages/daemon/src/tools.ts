/**
 * 工具实现 —— 把页面采集的原始状态组装成模型可读的结构。
 *
 * 智能集中在此：体检、diff、摘要、降级判定。页面（ggb-bridge）只做原始访问。
 *
 * 三条不变量（已裁定）：
 *  1. commands[] 是唯一真源；objects/sliders/png/audit 全是派生，现场重算不持久化
 *  2. 读写不对称：写 = 全量指令清单（或对象级轻改的落账结果）；读 = 结构摘要 + 画布 PNG + 上轮 audit
 *  3. 校验不拦路：无效行剔除后照常下发，明细回传给 agent 自行决定
 *
 * 另借鉴 OpenDesign 的「受管工作目录」：当前构造落在
 * <cwd>/construction.ggb.txt —— **agent 的可编辑工作稿**。像改代码一样改它，
 * 改完调 ggb_apply()（不带参数）生效。**getState 不回写文件**：那会冲掉 agent
 * 改到一半的草稿；只在 apply / reset 后回写。
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  auditConstruction,
  detectSliders,
  diffCommands,
  summarizeObjects,
  GGB_ERROR,
  type AuditResult,
  type BoardState,
  type DiffResult,
  type ObjectSummary,
  type RawState,
  type SliderState,
} from '@mathmover/ggb-core';
import type { GgbBridgeClient } from './bridge-client.ts';

export interface ToolsConfig {
  /** 受管工作目录：构造文件写这里。默认 process.cwd() */
  workdir: string;
  /** 画布 PNG 是否随状态返回（默认 true） */
  includePng: boolean;
  /** PNG 最长边（默认 900，与 applet 一致） */
  pngMaxEdge: number;
}

/**
 * 按操作区分超时预算。
 *
 * apply：要等 GeoGebra 就绪 + 全量回放 + 体检，**首次调用尤其慢**（实测曾超 15s）。
 *        给 60s；超时也不算失败，见 apply 的降级处理。
 * getState：只读，但要等画布绘制完成再取图，给 20s。
 */
export const APPLY_TIMEOUT_MS = 60_000;
export const GETSTATE_TIMEOUT_MS = 20_000;

export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
  workdir: process.cwd(),
  includePng: true,
  pngMaxEdge: 900,
};

/** 把派生视图组装成 BoardState。 */
export function buildBoardState(raw: RawState, cfg: ToolsConfig): BoardState {
  // 边界防御：raw 来自 WebSocket，可能是畸形/不完整的。
  // 直接把 undefined 塞给 auditConstruction 只会得到一句看不懂的
  // 「lines is not iterable」，故在此归一并如实降级。
  const commands = Array.isArray(raw?.commands) ? raw.commands : [];
  const names = Array.isArray(raw?.names) ? raw.names : Object.keys(raw?.objects ?? {});
  const objectsMap = raw?.objects && typeof raw.objects === 'object' ? raw.objects : {};
  const slidersRaw = Array.isArray(raw?.sliders) ? raw.sliders : [];
  const malformed = commands.length === 0 && (!raw?.commands || !Array.isArray(raw.commands));

  // 注意：这里刻意**不提供** getMin/getMax/getStep ——
  // 2026-10-09 spike 实测 classic applet 没有这三个方法。
  // 缺席会让 detectSliders 自动置 rangeIsDefault=true，避免把缺省范围当真实范围。
  const api = {
    getAllObjectNames: () => names,
    getObjectType: (n: string) => objectsMap[n]?.type ?? '?',
    getValueString: (n: string) => objectsMap[n]?.value ?? '',
    getValue: (n: string) => slidersRaw.find((s) => s.name === n)?.value ?? 0,
    isIndependent: (n: string) => objectsMap[n]?.independent ?? false,
  };
  const objects: ObjectSummary[] = summarizeObjects(api);
  const sliders: SliderState[] = detectSliders(api).map((s) => ({
    ...s,
    // 页面侧的滑块没带 min/max/step，补上探测不到时的缺省并如实标注
    min: s.min ?? -10,
    max: s.max ?? 10,
    step: s.step ?? 0.1,
    rangeIsDefault: true,
  }));
  const png = raw?.png ?? null;
  const pngSource = raw?.pngSource ?? 'none';
  const generation = typeof raw?.generation === 'number' ? raw.generation : -1;

  const audit: AuditResult = auditConstruction(api, commands);

  const degradedReasons: string[] = [];
  if (pngSource === 'none') degradedReasons.push('png-unavailable');
  if (audit.degraded) degradedReasons.push('audit-degraded-no-value-string');
  if (malformed) degradedReasons.push('malformed-state-payload');

  return {
    commands: [...commands],
    objects,
    sliders,
    png: {
      base64: cfg.includePng ? png : null,
      source: pngSource === 'none' ? null : pngSource,
      width: null,
      height: null,
      nonBlank: png ? true : null,
      degradedReason: png ? undefined : 'png-unavailable',
    },
    audit,
    mode: commands.some((c) => /^\s*MODE\s*:?\s*3d/i.test(c)) ? '3D' : '2D',
    generation,
    degraded: degradedReasons.length > 0,
    degradedReasons,
  };
}

/**
 * 把当前构造写进受管工作目录 —— **agent 的工作稿**，可直接编辑。
 *
 * 与 codex/claude 的受管工作目录同构：文件就是当前构造的可编辑形态。
 * agent 用原生 Read/Edit 改它（像改代码），改完调 `ggb_apply()`（不带参数）生效。
 * daemon 在 apply/reset 后回写规范化后的清单。
 *
 * **文件只存指令行，不加任何头注释**——否则原生 Read 与 read_construction
 * 会看到两种长度（头被后者剥掉），agent 会误判「文件不同步」而反复倒腾。
 * 「这文件能改、改完 apply」的说明放工具描述与 SYSTEM_BRIEF，不放文件里。
 */
export function writeConstructionFile(cfg: ToolsConfig, commands: string[]): string {
  const file = path.join(cfg.workdir, CONSTRUCTION_FILE);
  const body = commands.length ? [...commands, ''].join('\n') : '';
  try {
    fs.mkdirSync(cfg.workdir, { recursive: true });
    fs.writeFileSync(file, body, 'utf-8');
    return file;
  } catch {
    return '';
  }
}

const CONSTRUCTION_FILE = 'construction.ggb.txt';

/**
 * 读工作稿。`#` 行一律跳过——那是历史版本的头注释，不是 GGB 指令
 * （GGB 注释是 `//`，会被保留）。文件不存在返回 []。
 */
export function readConstructionFile(cfg: ToolsConfig): string[] {
  try {
    const body = fs.readFileSync(path.join(cfg.workdir, CONSTRUCTION_FILE), 'utf8');
    const lines = body.split('\n').map((l) => l.replace(/\r$/, ''));
    const mid = lines.filter((l) => !l.trimStart().startsWith('#'));
    while (mid.length > 0 && !mid[0].trim()) mid.shift();
    while (mid.length > 0 && !mid[mid.length - 1].trim()) mid.pop();
    return mid;
  } catch {
    return [];
  }
}

/**
 * 纯追加判定：`after` 以 `before` 为前缀、只在后面加了行。
 * 成立则页面只需执行新增行（不清屏），对象逐个冒出来——首图的渐进感就靠它。
 */
export function pureAppendDelta(before: string[], after: string[]): string[] | null {
  if (before.length === 0) return null;
  if (after.length <= before.length) return null;
  for (let i = 0; i < before.length; i++) {
    if (before[i].trim() !== after[i].trim()) return null;
  }
  return after.slice(before.length);
}

export class GgbTools {
  private readonly bridge: Pick<GgbBridgeClient, 'connected' | 'snapshot' | 'call'>;
  private readonly cfg: ToolsConfig;

  // 不用构造函数参数属性：Node 的 TS 类型剥离不支持该语法。
  constructor(bridge: Pick<GgbBridgeClient, 'connected' | 'snapshot' | 'call'>, cfg: ToolsConfig = DEFAULT_TOOLS_CONFIG) {
    this.bridge = bridge;
    this.cfg = cfg;
  }

  private requireLive(): void {
    if (!this.bridge.connected) {
      throw new Error(
        `${GGB_ERROR.SESSION_DEAD}: 没有已连接的画布。请确认工作台页面已打开、GeoGebra 已就绪。`,
      );
    }
  }

  /** 读当前状态（含体检）。**不回写工作稿**——那会冲掉 agent 改到一半的草稿。 */
  async getState(opts: { png?: boolean } = {}): Promise<BoardState> {
    this.requireLive();
    const raw = await this.bridge.call<RawState>('getState', undefined, GETSTATE_TIMEOUT_MS);
    return buildBoardState(raw, { ...this.cfg, includePng: opts.png ?? this.cfg.includePng });
  }

  /**
   * 覆盖画布。`commands` 不传 = 读工作稿 `construction.ggb.txt`（agent 像改代码
   * 一样改完后调用）。纯追加时自动走增量（页面不清屏，对象逐个出现），否则全量回放。
   *
   * **超时语义**：apply 要等 GeoGebra 就绪 + 回放 + 体检，首次调用可能很慢。
   * 超时**不等于失败**——构造很可能已经生效。此时不抛错，而是：
   *   ① 重新读一次画布（拿到实际结果）
   *   ② 标记 degraded + 'apply-timeout-unconfirmed'
   *   ③ 返回已知部分结果，让 agent 自行核对，而不是被骗着重做一遍
   */
  async apply(commands?: string[], opts: { png?: boolean; incremental?: boolean } = {}): Promise<{
    state: BoardState;
    diff: DiffResult;
    applied: string[];
    failedFirstPass: string[];
    durationMs: number;
    /** true = 本次走纯追加增量（页面未清屏，对象逐个出现） */
    incremental?: boolean;
    /** true = 本次结果未被完整确认，见 state.degradedReasons */
    unconfirmed?: boolean;
  }> {
    this.requireLive();
    const list = commands ?? readConstructionFile(this.cfg);
    if (list.length === 0) {
      throw new Error('没有可下发的指令：请传 commands，或先编辑 construction.ggb.txt');
    }
    const before = this.bridge.snapshot?.commands ?? [];
    const includePng = opts.png ?? this.cfg.includePng;

    const delta = opts.incremental === false ? null : pureAppendDelta(before, list);
    const useIncremental = opts.incremental === true || (opts.incremental !== false && delta !== null);
    const sendList = useIncremental && delta ? delta : list;

    try {
      const result = await this.bridge.call<{
        applied: string[];
        failedFirstPass: string[];
        durationMs: number;
        state: RawState;
      }>('apply', {
        commands: sendList,
        incremental: useIncremental,
        // 增量时页面只执行新行，但账本必须是完整清单（唯一真源）
        ledger: useIncremental && delta ? list : undefined,
      }, useIncremental ? GETSTATE_TIMEOUT_MS : APPLY_TIMEOUT_MS);

      const state = buildBoardState(result.state, { ...this.cfg, includePng });
      const diff = diffCommands(before, result.state.commands);
      writeConstructionFile(this.cfg, result.state.commands);

      return {
        state,
        diff,
        applied: result.applied,
        failedFirstPass: result.failedFirstPass,
        durationMs: result.durationMs,
        incremental: useIncremental || undefined,
      };
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      // 只对「超时」降级；连接死了之类的真错误照旧抛
      if (!msg.includes('GGB_CALL_TIMEOUT')) throw e;

      let state: BoardState;
      try {
        // 构造很可能已生效——重新读一次，把实际结果如实告诉 agent
        const raw = await this.bridge.call<RawState>('getState', undefined, GETSTATE_TIMEOUT_MS);
        state = buildBoardState(raw, { ...this.cfg, includePng });
      } catch {
        state = buildBoardState(
          { commands: list, names: [], objects: {}, sliders: [], png: null, pngSource: 'none', generation: -1 },
          { ...this.cfg, includePng: false },
        );
      }

      state = {
        ...state,
        degraded: true,
        degradedReasons: [...state.degradedReasons, 'apply-timeout-unconfirmed'],
      };
      writeConstructionFile(this.cfg, state.commands);

      return {
        state,
        diff: diffCommands(before, state.commands),
        applied: list,
        failedFirstPass: [],
        durationMs: APPLY_TIMEOUT_MS,
        unconfirmed: true,
      };
    }
  }

  /** 读工作稿（供 BYOK 等无原生文件能力的 agent 走工具面）。恒异步——与 ToolsLike 对齐。 */
  async readConstruction(): Promise<string[]> {
    return readConstructionFile(this.cfg);
  }

  /** 写工作稿（不下发画布——下发请再调 apply）。恒异步——与 ToolsLike 对齐。 */
  async writeConstruction(commands: string[]): Promise<string> {
    return writeConstructionFile(this.cfg, commands);
  }

  /** 清空画布。 */
  async reset(): Promise<void> {
    this.requireLive();
    await this.bridge.call('reset');
    writeConstructionFile(this.cfg, []);
  }

  /** 健康探针。注意：不创建任何探针对象，避免污染 getAllObjectNames/滑块探测。 */
  ping(): boolean {
    return this.bridge.connected;
  }
}
