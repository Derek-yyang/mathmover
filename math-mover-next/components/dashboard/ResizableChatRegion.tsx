'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { chatWidthForKey, chatWidthLimits, clampChatWidth, DEFAULT_CHAT_WIDTH } from '@/lib/chat-panel-width';
import { signalBoardResizePreview } from '@/lib/board-resize-preview';

export default function ResizableChatRegion({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  const regionRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_CHAT_WIDTH);
  const [limits, setLimits] = useState({ min: 320, max: 720 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const frameRef = useRef(0);
  const pendingWidthRef = useRef(DEFAULT_CHAT_WIDTH);
  const hintId = useId();
  const panelId = useId();

  const finishDrag = useCallback((cancel = false) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    signalBoardResizePreview('chat', false);
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    setWidth(cancel ? drag.startWidth : pendingWidthRef.current);
    setDragging(false);
    if (handleRef.current?.hasPointerCapture(drag.pointerId)) handleRef.current.releasePointerCapture(drag.pointerId);
  }, []);

  useEffect(() => {
    const workspace = regionRef.current?.parentElement;
    if (!workspace) return;
    const observer = new ResizeObserver(() => {
      const next = chatWidthLimits(workspace.clientWidth);
      setLimits(next);
      setWidth(value => clampChatWidth(value, next));
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const style = document.body.style;
    const cursor = style.cursor;
    const selection = style.userSelect;
    style.cursor = 'col-resize';
    style.userSelect = 'none';
    const cancel = () => finishDrag(true);
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', keydown);
    return () => {
      style.cursor = cursor;
      style.userSelect = selection;
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', keydown);
    };
  }, [dragging, finishDrag]);

  useEffect(() => {
    if (disabled) finishDrag();
  }, [disabled, finishDrag]);

  useEffect(() => () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); }, []);

  const handleMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    pendingWidthRef.current = clampChatWidth(drag.startWidth + drag.startX - event.clientX, limits);
    if (!frameRef.current) frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      setWidth(pendingWidthRef.current);
    });
  };

  return (
    <div ref={regionRef} className="relative h-full min-h-0 min-w-0 shrink-0" style={{ width: clampChatWidth(width, limits) }}>
      <div id={panelId} className="h-full w-full min-w-0">{children}</div>
      <span id={hintId} className="sr-only">拖动调整宽度，左右方向键微调，Home 最窄，End 最宽，双击恢复默认宽度，Esc 取消拖动。</span>
      <div
        ref={handleRef}
        role="separator"
        aria-label="调整聊天区宽度"
        aria-orientation="vertical"
        aria-controls={panelId}
        aria-describedby={hintId}
        aria-valuemin={limits.min}
        aria-valuemax={limits.max}
        aria-valuenow={clampChatWidth(width, limits)}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        title="拖动调整聊天区宽度，双击恢复默认"
        className={`group absolute inset-y-0 -left-1.5 z-20 w-3 touch-none cursor-col-resize outline-none ${disabled ? 'pointer-events-none invisible' : ''}`}
        onPointerDown={event => {
          if (disabled || event.button !== 0 || dragRef.current) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
          pendingWidthRef.current = width;
          signalBoardResizePreview('chat', true);
          setDragging(true);
        }}
        onPointerMove={handleMove}
        onPointerUp={event => { if (event.pointerId === dragRef.current?.pointerId) { handleMove(event); finishDrag(); } }}
        onPointerCancel={event => { if (event.pointerId === dragRef.current?.pointerId) finishDrag(true); }}
        onLostPointerCapture={event => { if (event.pointerId === dragRef.current?.pointerId) finishDrag(); }}
        onDoubleClick={() => setWidth(clampChatWidth(DEFAULT_CHAT_WIDTH, limits))}
        onKeyDown={event => {
          const next = chatWidthForKey(width, event.key, event.shiftKey, limits);
          if (next === null || disabled) return;
          event.preventDefault();
          setWidth(next);
        }}
      >
        <span className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 group-hover:bg-[var(--mm-bg-emerald-600)] group-focus-visible:bg-[var(--mm-bg-emerald-700)] ${dragging ? 'bg-[var(--mm-bg-emerald-600)]' : 'bg-transparent'}`} />
        <span aria-hidden="true" className={`absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full group-hover:bg-[var(--mm-bg-emerald-600)] group-focus-visible:bg-[var(--mm-bg-emerald-700)] ${dragging ? 'bg-[var(--mm-bg-emerald-600)]' : 'bg-[var(--mm-bg-stone-300)]'}`} />
      </div>
    </div>
  );
}
