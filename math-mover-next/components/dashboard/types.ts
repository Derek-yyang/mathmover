import type { AgentDiagnostic } from '@/lib/agent-diagnostics';
import type { AgentExecution } from '@/lib/agent-progress';

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

export interface SliderItem {
  name: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  isAnimating?: boolean;
}

export interface AuditFinding {
  kind: 'missing' | 'undefined';
  name: string;
  line: string;
}

export interface AuditResult {
  findings: AuditFinding[];
  missing: AuditFinding[];
  undefinedObjs: AuditFinding[];
  degraded: boolean;
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
  status?: 'classifying' | 'generating' | 'completed' | 'error' | 'stopped';
  category?: string;
  categoryLabel?: string;
  commands?: string[];
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
