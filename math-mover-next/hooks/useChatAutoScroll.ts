'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isNearChatBottom } from '@/lib/agent-progress';

export function useChatAutoScroll(revision: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const returning = useRef(false);
  const frame = useRef<number | null>(null);
  const touchY = useRef<number | null>(null);
  const [showLatest, setShowLatest] = useState(false);

  const scheduleFollow = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const element = scrollRef.current;
      if (element && following.current && !returning.current) {
        // Stream updates are batched per frame, never a new smooth animation
        // per token. Only this chat container moves, not the whole dashboard.
        element.scrollTop = element.scrollHeight;
      } else if (element && !following.current) {
        setShowLatest(!isNearChatBottom(element.scrollTop, element.scrollHeight, element.clientHeight));
      }
    });
  }, []);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const near = isNearChatBottom(element.scrollTop, element.scrollHeight, element.clientHeight);
    if (returning.current && !near) return;
    returning.current = false;
    following.current = near;
    setShowLatest(!near);
  }, []);

  const interrupt = useCallback(() => {
    const element = scrollRef.current;
    // A wheel/touch gesture on a short, non-scrollable conversation has not
    // moved the reader into history. Future content should still be followed.
    if (!returning.current && (!element || element.scrollHeight <= element.clientHeight)) return;
    following.current = false;
    if (returning.current) {
      returning.current = false;
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollTop, behavior: 'auto' });
    }
  }, []);

  const backToLatest = useCallback((smooth = true) => {
    const element = scrollRef.current;
    if (!element) return;
    following.current = true;
    setShowLatest(false);
    const animate = smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    returning.current = animate;
    element.scrollTo({ top: element.scrollHeight, behavior: animate ? 'smooth' : 'auto' });
    if (!animate) scheduleFollow();
  }, [scheduleFollow]);

  useEffect(() => { scheduleFollow(); }, [revision, scheduleFollow]);
  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element || !content) return;
    // Covers tool disclosures, image loads and sidebar/viewport resizing too.
    const observer = new ResizeObserver(scheduleFollow);
    observer.observe(element);
    observer.observe(content);
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) interrupt(); };
    const onTouchStart = (event: TouchEvent) => { touchY.current = event.touches[0]?.clientY ?? null; };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y !== undefined && touchY.current !== null && y > touchY.current) interrupt();
      touchY.current = y ?? null;
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select'))) return;
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) interrupt();
    };
    const onPointer = (event: PointerEvent) => {
      // Dragging the scrollbar is also a deliberate interruption, including
      // when a smooth return is currently in flight.
      if (event.target === element && event.clientX >= element.getBoundingClientRect().right - 18) interrupt();
    };
    const onScrollEnd = () => {
      if (!returning.current) return;
      returning.current = false;
      scheduleFollow();
    };
    element.addEventListener('wheel', onWheel, { passive: true });
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: true });
    element.addEventListener('keydown', onKey);
    element.addEventListener('pointerdown', onPointer);
    element.addEventListener('scrollend', onScrollEnd);
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('keydown', onKey);
      element.removeEventListener('pointerdown', onPointer);
      element.removeEventListener('scrollend', onScrollEnd);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [interrupt, scheduleFollow]);

  return { scrollRef, contentRef, onScroll, showLatest, backToLatest };
}
