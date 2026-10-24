/** 桌面壳通过 preload 暴露的最小桥；浏览器里不存在。 */
export type DesktopAction =
  | 'check-updates'
  | 'restart-update'
  | 'retry-update'
  | 'open-logs'
  | 'copy-diagnostics'
  | 'about';

export interface DesktopPreferences {
  closeToTray: boolean;
  trayAvailable: boolean;
}

export interface DesktopAboutInfo {
  version: string;
  diagnostics: string;
}

/** 主进程推送的更新状态；标题栏据此画状态环。 */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'downloading'; version?: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'failed'; message?: string };

/** 模态遮罩的合成前颜色（渲染进程从遮罩元素上读出）。 */
export interface DesktopOverlayColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface DesktopBridge {
  isDesktop: true;
  getVersion(): Promise<string>;
  /** Optional for compatibility with an already-running, older desktop shell. */
  openStorageDirectory?(target: 'data' | 'backups'): Promise<void>;
  getPreferences(): Promise<DesktopPreferences>;
  setCloseToTray(enabled: boolean): Promise<DesktopPreferences>;
  action(action: DesktopAction): void;
  onShowAbout(listener: (info: DesktopAboutInfo) => void): () => void;
  setTitleBarTheme(theme: 'light' | 'dark'): void;
  /** 模态开合时同步原生按钮区底色（网页遮罩盖不住原生图层） */
  setTitleBarModal(open: boolean, overlay?: DesktopOverlayColor): void;
  getUpdateState(): Promise<UpdateState>;
  /** 订阅更新状态；返回取消订阅函数 */
  onUpdateState(listener: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window {
    mathmoverDesktop?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.mathmoverDesktop;
}
