export const BOARD_RESIZE_PREVIEW_EVENT = 'mathmover:board-resize-preview';

export function signalBoardResizePreview(source: 'sidebar' | 'chat', active: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BOARD_RESIZE_PREVIEW_EVENT, { detail: { source, active } }));
}
