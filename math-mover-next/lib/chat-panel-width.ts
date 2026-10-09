export const DEFAULT_CHAT_WIDTH = 384;

export function chatWidthLimits(workspaceWidth: number) {
  const available = Number.isFinite(workspaceWidth) ? Math.max(0, workspaceWidth) : 0;
  // 正常窗口保留至少 480px 画板；窄窗口最多各占一半。
  const max = Math.floor(Math.min(720, available - Math.min(480, available / 2)));
  return { min: Math.min(320, max), max };
}

export function clampChatWidth(width: number, limits: { min: number; max: number }) {
  return Math.round(Math.min(limits.max, Math.max(limits.min, width)));
}

export function chatWidthForKey(width: number, key: string, shift: boolean, limits: { min: number; max: number }) {
  const step = shift ? 48 : 16;
  if (key === 'Home') return limits.min;
  if (key === 'End') return limits.max;
  if (key === 'ArrowLeft') return clampChatWidth(width + step, limits);
  if (key === 'ArrowRight') return clampChatWidth(width - step, limits);
  return null;
}
