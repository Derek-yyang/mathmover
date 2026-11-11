'use client';

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import styles from '@/app/landing.module.css';

export function LandingHeader({ children }: { children: ReactNode }) {
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const expandSentinelRef = useRef<HTMLSpanElement>(null);
  const cancelReturnToTop = useRef<(() => void) | null>(null);
  const [scrolled, setScrolled] = useState(false);

  const returnToTop = (event: MouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-scroll-top]')) return;
    event.preventDefault();
    cancelReturnToTop.current?.();
    window.history.replaceState(window.history.state, '', '#top');

    const root = document.documentElement;
    const startY = window.scrollY;
    if (startY === 0) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.scrollTop = 0;
      document.body.scrollTop = 0;
      return;
    }

    const inlineBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    const duration = Math.min(1_200, Math.max(650, startY * 0.09));
    const startedAt = performance.now();
    let frame = 0;
    let active = true;

    const finish = () => {
      if (!active) return;
      active = false;
      cancelAnimationFrame(frame);
      root.style.scrollBehavior = inlineBehavior;
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
      window.removeEventListener('keydown', cancelOnKey);
      cancelReturnToTop.current = null;
    };
    const cancel = () => finish();
    const cancelOnKey = (keyboardEvent: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(keyboardEvent.key)) finish();
    };
    const step = (now: number) => {
      if (!active) return;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress < .5
        ? 4 * progress ** 3
        : 1 - (-2 * progress + 2) ** 3 / 2;
      const nextY = Math.round(startY * (1 - eased));
      root.scrollTop = nextY;
      document.body.scrollTop = nextY;
      if (progress < 1) frame = requestAnimationFrame(step);
      else finish();
    };

    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('touchstart', cancel, { passive: true });
    window.addEventListener('keydown', cancelOnKey);
    cancelReturnToTop.current = finish;
    frame = requestAnimationFrame(step);
  };

  useEffect(() => () => cancelReturnToTop.current?.(), []);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const expandSentinel = expandSentinelRef.current;
    if (!sentinel || !expandSentinel) return;
    // Keep the current shape between the two boundaries so small reversals
    // around the collapse point cannot repeatedly restart the transition.
    const observer = new IntersectionObserver(() => {
      setScrolled(previous => window.scrollY >= 96 ? true : window.scrollY <= 40 ? false : previous);
    });
    observer.observe(sentinel);
    observer.observe(expandSentinel);
    return () => observer.disconnect();
  }, []);

  return <>
    <div className={styles.headerSpace} aria-hidden="true"><span ref={sentinelRef} className={styles.headerSentinel} /><span ref={expandSentinelRef} className={`${styles.headerSentinel} ${styles.headerExpandSentinel}`} /></div>
    <header className={styles.header} data-scrolled={scrolled} onClick={returnToTop}>
      <div className={styles.navInner}>{children}</div>
    </header>
  </>;
}
