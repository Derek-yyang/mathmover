'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from '@/app/landing.module.css';

export function LandingHeader({ children }: { children: ReactNode }) {
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const expandSentinelRef = useRef<HTMLSpanElement>(null);
  const [scrolled, setScrolled] = useState(false);

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
    <header className={styles.header} data-scrolled={scrolled}>
      <div className={styles.navInner}>{children}</div>
    </header>
  </>;
}
