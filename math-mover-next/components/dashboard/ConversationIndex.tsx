'use client';

import { memo, useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { ConversationTurn } from '@/lib/conversation-index';
import { readingTurnIndex } from '@/lib/conversation-index';

interface Props {
  turns: ConversationTurn[];
  viewportRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  onNavigate: () => void;
}

function ConversationIndex({ turns, viewportRef, contentRef, onNavigate }: Props) {
  const previewId = useId();
  const [layout, setLayout] = useState({ height: 0, width: 0, overflow: false, active: 0 });
  const [previewState, setPreviewState] = useState<{ id: string; pointer: boolean } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const offsetsRef = useRef<number[]>([]);
  const anchorsRef = useRef<HTMLDivElement[]>([]);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const frameRef = useRef(0);
  const jumpFrameRef = useRef(0);
  const ids = turns.map(turn => turn.id);
  const idsKey = JSON.stringify(ids);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const wanted: string[] = JSON.parse(idsKey);
    // Message shells remain mounted. A growing reply changes their offsets,
    // but not their identity; avoid scanning all Markdown DOM on every delta.
    const nodes = new Map(Array.from(content.querySelectorAll<HTMLDivElement>('[data-chat-message="user"][data-chat-message-id]'))
      .map(node => [node.dataset.chatMessageId, node]));
    anchorsRef.current = wanted.flatMap(id => nodes.has(id) ? [nodes.get(id)!] : []);
    let measureFrom = 0;
    const update = () => {
      frameRef.current = 0;
      if (measureFrom < anchorsRef.current.length) {
        const top = viewport.getBoundingClientRect().top + viewport.clientTop;
        for (let index = measureFrom; index < anchorsRef.current.length; index++) {
          offsetsRef.current[index] = anchorsRef.current[index].getBoundingClientRect().top - top + viewport.scrollTop;
        }
        offsetsRef.current.length = anchorsRef.current.length;
      }
      measureFrom = anchorsRef.current.length;
      const next = { height: viewport.clientHeight, width: viewport.clientWidth,
        overflow: viewport.scrollHeight > viewport.clientHeight + 2,
        active: readingTurnIndex(offsetsRef.current, viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight) };
      setLayout(previous => previous.height === next.height && previous.width === next.width
        && previous.overflow === next.overflow && previous.active === next.active ? previous : next);
    };
    const schedule = () => { if (!frameRef.current) frameRef.current = requestAnimationFrame(update); };
    // Only anchors after a changed message can move. Streaming at the end
    // changes overflow, but does not require remeasuring hundreds of questions.
    const affectedAnchor = new Map<Element, number>();
    let nextAnchor = 0;
    for (const node of content.querySelectorAll<HTMLDivElement>('[data-chat-message]')) {
      if (node === anchorsRef.current[nextAnchor]) nextAnchor++;
      affectedAnchor.set(node, nextAnchor);
    }
    const cancelJump = () => { cancelAnimationFrame(jumpFrameRef.current); jumpFrameRef.current = 0; };
    const cancelJumpOnKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancelJump();
    };
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) measureFrom = Math.min(measureFrom,
        entry.target === viewport ? 0 : affectedAnchor.get(entry.target) ?? anchorsRef.current.length);
      schedule();
    });
    observer.observe(viewport);
    for (const node of affectedAnchor.keys()) observer.observe(node);
    viewport.addEventListener('scroll', schedule, { passive: true });
    viewport.addEventListener('wheel', cancelJump, { passive: true });
    viewport.addEventListener('pointerdown', cancelJump);
    viewport.addEventListener('keydown', cancelJumpOnKey);
    schedule();
    return () => {
      observer.disconnect();
      viewport.removeEventListener('scroll', schedule);
      viewport.removeEventListener('wheel', cancelJump);
      viewport.removeEventListener('pointerdown', cancelJump);
      viewport.removeEventListener('keydown', cancelJumpOnKey);
      cancelJump();
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [idsKey, viewportRef, contentRef]);

  useEffect(() => () => cancelAnimationFrame(jumpFrameRef.current), []);

  const navigate = useCallback((index: number) => {
    onNavigate();
    setPreviewState(null);
    cancelAnimationFrame(jumpFrameRef.current);
    // Give the viewport time to disable automatic following before moving it.
    jumpFrameRef.current = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const anchor = anchorsRef.current[index];
      if (!viewport || !anchor) return;
      const start = performance.now();
      const initialTop = viewport.scrollTop;
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320;
      let previousTarget = -1;
      let settledFrames = 0;
      // Markdown/images and content-visibility refine heights during a jump.
      // Track the actual anchor instead of ending at its old estimated offset.
      const move = (now: number) => {
        const top = anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientTop + viewport.scrollTop - 16;
        const target = Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight));
        const progress = duration ? Math.min(1, (now - start) / duration) : 1;
        viewport.scrollTo({ top: initialTop + (target - initialTop) * (1 - (1 - progress) ** 4), behavior: 'instant' });
        settledFrames = progress === 1 && Math.abs(target - previousTarget) < 1 ? settledFrames + 1 : 0;
        previousTarget = target;
        jumpFrameRef.current = settledFrames < 3 && now - start < 800 ? requestAnimationFrame(move) : 0;
      };
      jumpFrameRef.current = requestAnimationFrame(move);
    });
  }, [onNavigate, viewportRef]);

  const showPreview = useCallback((id: string) => setPreviewState({ id, pointer: true }), []);
  const focusMarker = useCallback((id: string) => { setFocusedId(id); setPreviewState({ id, pointer: false }); }, []);
  const focusAdjacent = useCallback((index: number, key: string) => {
    const next = key === 'ArrowUp' ? Math.max(0, index - 1)
      : key === 'ArrowDown' ? Math.min(turns.length - 1, index + 1)
      : key === 'Home' ? 0 : key === 'End' ? turns.length - 1 : null;
    if (next === null) return false;
    buttonsRef.current.get(turns[next].id)?.focus();
    return true;
  }, [turns]);

  if (turns.length < 2 || !layout.overflow || !layout.height) return null;
  const active = turns[Math.max(0, layout.active)]?.id;
  const previewIndex = turns.findIndex(turn => turn.id === previewState?.id);
  const preview = turns[previewIndex];
  const railHeight = Math.min(turns.length * 14, Math.max(14, layout.height - 48));
  const railTop = (layout.height - railHeight) / 2;
  const previewHeight = Math.min(140, Math.max(24, layout.height - 24));
  // Keep the preview inside the message area, even for its first/last marker.
  const previewTop = Math.max(12 - railTop,
    Math.min((previewIndex + 0.5) * railHeight / turns.length - 56, layout.height - railTop - previewHeight - 12));

  return <nav aria-label="会话索引" data-conversation-index
    className="absolute right-1 z-10 flex w-6 flex-col"
    style={{ top: railTop, height: railHeight }}
    onPointerLeave={() => { if (previewState?.pointer) setPreviewState(null); }}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setFocusedId(null); setPreviewState(null); }
    }}>
    {turns.map((turn, index) => <TurnMarker key={turn.id} turn={turn} index={index}
      active={turn.id === active} tabStop={turn.id === (focusedId ?? active)}
      previewId={previewState?.id === turn.id ? previewId : undefined} buttonsRef={buttonsRef}
      onNavigate={navigate} onPreview={showPreview} onFocus={focusMarker} onKey={focusAdjacent} />)}
    {preview && <div className="absolute right-full w-2" style={{ top: previewTop, height: previewHeight }} aria-hidden />}
    {preview && <div id={previewId} data-conversation-preview role="tooltip" className="absolute right-8 rounded-lg border border-[var(--mm-border-stone-200)] bg-[var(--mm-surface)] px-3 py-2.5 text-xs leading-5 text-[var(--mm-text-stone-800)]"
      style={{ top: previewTop, width: Math.min(260, layout.width - 48), maxHeight: previewHeight, overflowY: 'auto' }}>
      <p className="mb-1 text-[var(--mm-text-stone-600)]">第 {preview.number} 轮 · 共 {turns.length} 轮</p>
      <p className="line-clamp-3 break-words [overflow-wrap:anywhere]">{preview.preview}</p>
      {preview.images > 0 && !preview.preview.startsWith('题目图片 ·') && <p className="mt-1 text-[var(--mm-text-stone-600)]">题目图片 · {preview.images} 张</p>}
    </div>}
  </nav>;
}

export default memo(ConversationIndex);

const TurnMarker = memo(function TurnMarker({ turn, index, active, tabStop, previewId, buttonsRef, onNavigate, onPreview, onFocus, onKey }: {
  turn: ConversationTurn; index: number; active: boolean; tabStop: boolean; previewId?: string;
  buttonsRef: RefObject<Map<string, HTMLButtonElement>>;
  onNavigate: (index: number) => void; onPreview: (id: string) => void; onFocus: (id: string) => void;
  onKey: (index: number, key: string) => boolean;
}) {
  return <button type="button"
    ref={node => { if (node) buttonsRef.current.set(turn.id, node); else buttonsRef.current.delete(turn.id); }}
    aria-label={`第 ${turn.number} 轮：${turn.preview}`} aria-current={active ? 'location' : undefined}
    aria-describedby={previewId} tabIndex={tabStop ? 0 : -1} data-turn-id={turn.id}
    className="group/index flex min-h-0 flex-1 cursor-pointer items-center justify-center rounded-sm outline-none focus-visible:bg-[var(--mm-bg-emerald-50)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--mm-border-emerald-700)]"
    onPointerEnter={() => onPreview(turn.id)} onFocus={() => onFocus(turn.id)} onClick={() => onNavigate(index)}
    onKeyDown={event => { if (onKey(index, event.key)) event.preventDefault(); }}>
    <span aria-hidden className={`h-px rounded-full transition-[width,background-color] duration-150 motion-reduce:transition-none group-hover/index:w-3 group-hover/index:bg-[var(--mm-bg-stone-600)] ${active ? 'w-3 bg-[var(--mm-bg-stone-700)]' : 'w-2 bg-[var(--mm-bg-stone-300)]'}`} />
  </button>;
});
