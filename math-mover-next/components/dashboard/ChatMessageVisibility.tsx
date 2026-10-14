'use client';

import { Activity, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { AgentChatMessage } from './types';

type Visibility = {
  eagerIds: Set<string>;
  observe: (node: HTMLElement, onVisible: (visible: boolean) => void) => () => void;
};
const VisibilityContext = createContext<Visibility | null>(null);
const TextVisibilityContext = createContext<{ active: boolean; text: string } | null>(null);

function isInteracting(node: HTMLElement) {
  if (node.contains(document.activeElement)) return true;
  // Preview dialogs live in a portal, outside the triggering message's DOM.
  if (node.querySelector('[aria-haspopup="dialog"][data-state="open"]')) return true;
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)).some(range => range.intersectsNode(node));
}

function whenNotInteracting(node: HTMLElement, delay: number, release: () => void) {
  let timer = 0;
  const detach = () => {
    node.removeEventListener('focusout', schedule);
    document.removeEventListener('selectionchange', schedule);
  };
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (isInteracting(node)) {
        node.addEventListener('focusout', schedule);
        if (!window.getSelection()?.isCollapsed) document.addEventListener('selectionchange', schedule);
      } else { detach(); release(); }
    }, delay);
  };
  schedule();
  return () => { window.clearTimeout(timer); detach(); };
}

/** Keep message shells and controls mounted; window only the expensive text body. */
export function ChatMessageVisibility({ messages, viewportRef, children }: {
  messages: AgentChatMessage[]; viewportRef: RefObject<HTMLDivElement | null>; children: ReactNode;
}) {
  const observer = useMemo(() => {
    let intersection: IntersectionObserver | undefined;
    const callbacks = new Map<Element, (visible: boolean) => void>();
    return {
      observe(node: HTMLElement, onVisible: (visible: boolean) => void) {
        if (typeof IntersectionObserver === 'undefined') { onVisible(true); return () => {}; }
        intersection ??= new IntersectionObserver(entries => {
          for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
        // Keep a modest warm window. A full 1000px margin wakes many Markdown
        // trees at once during a fast scroll on slower CPUs; 500px still hides
        // the rehydration for normal reading without creating that burst.
        }, { root: viewportRef.current, rootMargin: '500px 0px' });
        callbacks.set(node, onVisible);
        intersection.observe(node);
        return () => { intersection?.unobserve(node); callbacks.delete(node); };
      },
      dispose() { intersection?.disconnect(); intersection = undefined; callbacks.clear(); },
    };
  }, [viewportRef]);
  useEffect(() => () => observer.dispose(), [observer]);
  const eagerKey = JSON.stringify((messages.length < 60 ? messages : messages.slice(-4)).map(message => message.id));
  const value = useMemo(() => ({
    // Small threads and the latest turns render immediately, including new runs.
    eagerIds: new Set<string>(JSON.parse(eagerKey)),
    observe: observer.observe,
  }), [eagerKey, observer]);
  return <VisibilityContext.Provider value={value}>{children}</VisibilityContext.Provider>;
}

export function DeferredChatMessage({ message, children }: { message: AgentChatMessage; children: ReactNode }) {
  const visibility = useContext(VisibilityContext);
  const nodeRef = useRef<HTMLDivElement>(null);
  const eager = !visibility || visibility.eagerIds.has(message.id);
  const [revealed, setRevealed] = useState(eager);
  const [nearViewport, setNearViewport] = useState(eager);
  const [awake, setAwake] = useState(true);
  const [height, setHeight] = useState(0);
  // Editing can promote an old reply into the latest turns. Retain its controls
  // after that promotion, even when later replies move it out of the eager set.
  if (eager && !revealed) setRevealed(true);
  if (eager && !awake) setAwake(true);
  const visible = eager || revealed;
  const active = eager || awake;
  useEffect(() => {
    if (eager || !visibility || !nodeRef.current) return;
    return visibility.observe(nodeRef.current, near => {
      setNearViewport(near);
      if (near) { setRevealed(true); setAwake(true); }
    });
  }, [eager, visibility]);
  useEffect(() => {
    const node = nodeRef.current;
    if (!active || !visible || !node) return;
    const observer = new ResizeObserver(entries => {
      const size = entries[0]?.borderBoxSize[0]?.blockSize ?? entries[0]?.contentRect.height ?? 0;
      if (size > 0) setHeight(previous => Math.abs(previous - size) < 0.5 ? previous : size);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, visible]);
  useEffect(() => {
    const node = nodeRef.current;
    if (eager || nearViewport || !visible || !height || !node) return;
    // Release Markdown first, then pause subscriptions without discarding UI state.
    return whenNotInteracting(node, 650, () => setAwake(false));
  }, [eager, nearViewport, visible, height]);
  const textVisibility = useMemo(() => ({ active: eager || nearViewport, text: message.content }), [eager, nearViewport, message.content]);
  // Keep the measured shell in the document so the conversation index remains
  // stable, while asking the browser to skip paint/layout work for distant
  // messages. `containIntrinsicSize` prevents content-visibility from changing
  // the height that was measured before the runtime subscription was paused.
  const parkedStyle = !active && height > 0 ? {
    height,
    contentVisibility: 'auto' as const,
    containIntrinsicSize: `${height}px`,
  } : undefined;
  return <div ref={nodeRef} data-chat-message={message.role} data-chat-message-id={message.id}
    data-deferred-message={visible ? undefined : 'true'} data-suspended-message={active ? undefined : 'true'}
    className="min-w-0" style={parkedStyle}>
    <TextVisibilityContext.Provider value={textVisibility}>
      {visible ? <Activity mode={active ? 'visible' : 'hidden'}>{children}</Activity>
        : <div className="min-h-50"><span className="sr-only">{message.content}</span></div>}
    </TextVisibilityContext.Provider>
    {!active && <span className="sr-only">{message.content}</span>}
  </div>;
}

/** Tool/disclosure/edit state stays outside this boundary. Only Markdown is recycled. */
export function WindowedChatText({ children }: { children: ReactNode }) {
  const visibility = useContext(TextVisibilityContext);
  const active = visibility?.active !== false;
  const nodeRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [mounted, setMounted] = useState(true);
  if (active && !mounted) setMounted(true);
  useEffect(() => {
    const node = nodeRef.current;
    if (!active || !node) return;
    const observer = new ResizeObserver(entries => {
      const size = entries[0]?.borderBoxSize[0]?.blockSize ?? entries[0]?.contentRect.height ?? 0;
      // content-visibility may report zero before the ancestor becomes visible.
      if (size > 0) setHeight(previous => Math.abs(previous - size) < 0.5 ? previous : size);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active]);
  useEffect(() => {
    const node = nodeRef.current;
    if (active || !height || !node) return;
    return whenNotInteracting(node, 400, () => setMounted(false));
  }, [active, height]);
  return <div ref={nodeRef} data-windowed-chat-text={mounted ? undefined : 'true'}
    style={mounted ? undefined : { height }}>
    {mounted ? children : <span className="sr-only">{visibility?.text}</span>}
  </div>;
}
