'use client';

import { useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import styles from '@/app/landing.module.css';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  // Storage is unavailable on the server; keep the first render identical.
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  // Resolve an existing "system" preference before choosing the opposite theme.
  const dark = mounted && resolvedTheme === 'dark';
  const label = dark ? '切换到浅色主题' : '切换到深色主题';

  return <motion.button type="button" className={styles.themeTrigger} disabled={!mounted} tabIndex={0}
    whileHover={reduceMotion ? undefined : { scale: 1.1 }}
    whileTap={reduceMotion ? undefined : { scale: 0.95 }}
    transition={{ type: 'tween', duration: 0.15 }}
    onClick={() => setTheme(dark ? 'light' : 'dark')}
    aria-label={label} title={label}>
    <span className={styles.themeIcons} aria-hidden="true">
      {mounted && <AnimatePresence mode="wait" initial={false}>
        <motion.span key={dark ? 'dark' : 'light'} className={styles.themeIcon}
          initial={{ y: reduceMotion ? 0 : -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: reduceMotion ? 0 : 10, opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.15 }}>
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </motion.span>
      </AnimatePresence>}
    </span>
  </motion.button>;
}
