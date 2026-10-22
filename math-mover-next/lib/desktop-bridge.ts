/** 桌面壳通过 preload 暴露的最小桥；浏览器里不存在。 */
export type DesktopAction = 'check-updates' | 'open-logs' | 'copy-diagnostics' | 'about';

export interface DesktopBridge {
  isDesktop: true;
  action(action: DesktopAction): void;
  setTitleBarTheme(theme: 'light' | 'dark'): void;
}

declare global {
  interface Window {
    mathmoverDesktop?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.mathmoverDesktop;
}
