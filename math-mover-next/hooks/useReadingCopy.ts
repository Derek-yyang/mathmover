'use client';

// Adapted from assistant-ui use-copy-to-clipboard (MIT), adding visible failure feedback.
import { useEffect, useRef, useState } from 'react';

export function useReadingCopy() {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; clearTimeout(timer.current); }, []);
  const copy = async (value: string) => {
    const current = ++generation.current;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      if (current !== generation.current) return;
      setStatus('copied');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus('idle'), 3000);
    } catch {
      if (current === generation.current) { clearTimeout(timer.current); setStatus('error'); }
    }
  };
  return { status, copy };
}
