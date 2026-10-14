import type { AgentDiagnostic } from '@/lib/agent-diagnostics';
import type { AgentExecution } from '@/lib/agent-progress';
// 体检类型是跨进程共享的领域契约，唯一真源在 ggb-core（本文件曾有第三份副本）。
// 注意只走子路径导出，不要从 '@mathmover/ggb-core' 整包引——那会把 sop/whitelist
// 连同 node:fs 拖进浏览器产物。
import type { AuditFinding, AuditResult } from '@mathmover/ggb-core/types';

export type { AuditFinding, AuditResult };

export type CoursewareExportFormat = 'html' | 'ggb' | 'png';

export interface GeoGebraApi {
  newConstruction: () => void;
  setPerspective: (p: string) => void;
  setAxesVisible: {
    (x: boolean, y: boolean, z?: boolean): void;
    (view: number, x: boolean, y: boolean, z: boolean): void;
  };
  setGridVisible: {
    (visible: boolean): void;
    (view: number, visible: boolean): void;
  };
  evalCommand: (cmd: string) => boolean | void;
  getValue: (name: string) => number;
  setValue: (name: string, val: number) => void;
  registerUpdateListener: (fn: (name: string) => void) => void;
  unregisterUpdateListener: (fn: (name: string) => void) => void;
  getBase64: (cb: (b64: string) => void) => void;
  getPNGBase64?: (exportScale: number, transparent: boolean, dpi?: number) => string;
  setBase64?: (b64: string, callback?: () => void) => void;
  registerAddListener?: (fn: (name: string) => void) => void;
  unregisterAddListener?: (fn: (name: string) => void) => void;
  registerRemoveListener?: (fn: (name: string) => void) => void;
  unregisterRemoveListener?: (fn: (name: string) => void) => void;
  registerClientListener?: (fn: (event: unknown) => void) => void;
  unregisterClientListener?: (fn: (event: unknown) => void) => void;
  getViewProperties?: (view: number) => unknown;
  getGraphicsOptions?: (view: number) => unknown;
  getPerspectiveXML?: () => string;
  setCoordSystem?: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
  refreshViews: () => void;
  recalcDisplay?: () => void;
  getAllObjectNames: () => string[];
  getObjectType: (name: string) => string;
  getValueString?: (name: string) => string;
  isIndependent: (name: string) => boolean;
  setAnimating?: (name: string, flag: boolean) => void;
  startAnimation?: () => void;
  stopAnimation?: () => void;
  reset?: () => void;
}

export interface ChatAttachment {
  id?: string;
  url: string;
  name?: string;
  contentType?: string;
  file?: File;
  unavailable?: boolean;
}

export interface AgentMeta {
  /** stopped = 用户主动打断；不要当错误呈现 */
  status?: 'generating' | 'completed' | 'error' | 'stopped';
  /** agent 起的课件名（submit_construction 的 title 入参），优先级高于「首条消息截断」 */
  title?: string;
  /** 本轮类别：题目增强才有值（get_expert_prompt / submit_construction 的 category 入参） */
  category?: string;
  categoryLabel?: string;
  /** 本轮实际下发的构造指令清单 */
  commands?: string[];
  /** 画布体检结果（useGgbSession 的 auditConstruction 产出） */
  auditResult?: AuditResult | null;
  errorMessage?: string;
  diagnostic?: AgentDiagnostic;
  execution?: AgentExecution;
  characters?: number;
}

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  attachments?: ChatAttachment[];
  meta?: AgentMeta;
}
