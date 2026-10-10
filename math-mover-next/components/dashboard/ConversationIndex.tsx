'use client';

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { ConversationTurn } from '@/lib/conversation-index';
import { readingTurnIndex } from '@/lib/conversation-index';

interface Props {
  turns: ConversationTurn[];
  viewportRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  onNavigate: () => void;
}

export default function ConversationIndex({ turns, viewportRef, contentRef, onNavigate }: Props) {
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
    let needsMeasure = true;
    const update = () => {
      frameRef.current = 0;
      if (needsMeasure) {
        const nodes = new Map(Array.from(content.querySelectorAll<HTMLDivElement>('[data-chat-message="user"][data-chat-message-id]'))
          .map(node => [node.dataset.chatMessageId, node]));
        anchorsRef.current = wanted.flatMap(id => nodes.has(id) ? [nodes.get(id)!] : []);
        const top = viewport.getBoundingClientRect().top + viewport.clientTop;
        offsetsRef.current = anchorsRef.current.map(node => node.getBoundingClientRect().top - top + viewport.scrollTop);
        needsMeasure = false;
      }
      const next = { height: viewport.clientHeight, width: viewport.clientWidth,
        overflow: viewport.scrollHeight > viewport.clientHeight + 2,
        active: readingTurnIndex(offsetsRef.current, viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight) };
      setLayout(previous => previous.height === next.height && previous.width === next.width
        && previous.overflow === next.overflow && previous.active === next.active ? previous : next);
    };
    const schedule = () => { if (!frameRef.current) frameRef.current = requestAnimationFrame(update); };
    const resize = () => { needsMeasure = true; schedule(); };
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      observer.disconnect();
      viewport.removeEventListener('scroll', schedule);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [idsKey, viewportRef, contentRef]);

  useEffect(() => () => cancelAnimationFrame(jumpFrameRef.current), []);

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

  const navigate = (index: number) => {
    onNavigate();
    setPreviewState(null);
    cancelAnimationFrame(jumpFrameRef.current);
    // Give the viewport time to disable automatic following before moving it.
    jumpFrameRef.current = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const anchor = anchorsRef.current[index];
      if (!viewport || !anchor) return;
      const top = anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientTop + viewport.scrollTop - 16;
      viewport.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
  };

  return <nav aria-label="会话索引" data-conversation-index
    className="absolute right-1 z-10 flex w-6 flex-col"
    style={{ top: railTop, height: railHeight }}
    onPointerLeave={() => { if (previewState?.pointer) setPreviewState(null); }}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setFocusedId(null); setPreviewState(null); }
    }}>
    {turns.map((turn, index) => <button key={turn.id} type="button"
      ref={node => { if (node) buttonsRef.current.set(turn.id, node); else buttonsRef.current.delete(turn.id); }}
      aria-label={`第 ${turn.number} 轮：${turn.preview}`}
      aria-current={turn.id === active ? 'location' : undefined}
      aria-describedby={previewState?.id === turn.id ? previewId : undefined}
      tabIndex={turn.id === (focusedId ?? active) ? 0 : -1}
      data-turn-id={turn.id}
      className="group/index flex min-h-0 flex-1 cursor-pointer items-center justify-center rounded-sm outline-none focus-visible:bg-emerald-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700"
      onPointerEnter={() => setPreviewState({ id: turn.id, pointer: true })}
      onFocus={() => { setFocusedId(turn.id); setPreviewState({ id: turn.id, pointer: false }); }}
      onClick={() => navigate(index)}
      onKeyDown={event => {
        const next = event.key === 'ArrowUp' ? Math.max(0, index - 1)
          : event.key === 'ArrowDown' ? Math.min(turns.length - 1, index + 1)
          : event.key === 'Home' ? 0 : event.key === 'End' ? turns.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        buttonsRef.current.get(turns[next].id)?.focus();
      }}>
      <span aria-hidden className={`h-px rounded-full transition-[width,background-color] duration-150 motion-reduce:transition-none group-hover/index:w-3 group-hover/index:bg-stone-600 ${turn.id === active ? 'w-3 bg-stone-700' : 'w-2 bg-stone-300'}`} />
    </button>)}
    {preview && <div className="absolute right-full w-2" style={{ top: previewTop, height: previewHeight }} aria-hidden />}
    {preview && <div id={previewId} data-conversation-preview role="tooltip" className="absolute right-8 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-xs leading-5 text-stone-800"
      style={{ top: previewTop, width: Math.min(260, layout.width - 48), maxHeight: previewHeight, overflowY: 'auto' }}>
      <p className="mb-1 text-stone-600">第 {preview.number} 轮 · 共 {turns.length} 轮</p>
      <p className="line-clamp-3 break-words [overflow-wrap:anywhere]">{preview.preview}</p>
      {preview.images > 0 && !preview.preview.startsWith('题目图片 ·') && <p className="mt-1 text-stone-600">题目图片 · {preview.images} 张</p>}
    </div>}
  </nav>;
}
