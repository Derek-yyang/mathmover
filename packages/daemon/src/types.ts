/**
 * daemon 侧的原始状态契约 —— 与 math-mover-next/lib/ggb-bridge.ts 的返回形状一一对应。
 *
 * 这里刻意是**原始**形状（objects 是 Record、没有 audit/diff）：
 * 页面只负责采集，结构化与智能由 tools.ts 调 @mathmover/ggb-core 完成。
 */

export interface RawState {
  /** 真源：当前已提交的全量指令清单 */
  commands: string[];
  names: string[];
  objects: Record<string, { type: string; value: string | null; independent: boolean }>;
  sliders: Array<{ name: string; value: number }>;
  /** canvas.toDataURL 的 base64 段（不含 dataURL 前缀） */
  png: string | null;
  pngSource: 'canvas-to-data-url' | 'none';
  generation: number;
}

export interface RawApplyResult {
  applied: string[];
  failedFirstPass: string[];
  durationMs: number;
  state: RawState;
}
