'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import styles from '@/app/landing.module.css';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // Storage is unavailable on the server; keep the first render identical.
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  // Resolve an existing "system" preference before choosing the opposite theme.
  const dark = mounted && resolvedTheme === 'dark';
  const label = dark ? '切换到浅色主题' : '切换到深色主题';

  return <button type="button" className={styles.themeTrigger} disabled={!mounted}
    onClick={() => setTheme(dark ? 'light' : 'dark')}
    aria-label={label} title={label}>
    <span className={styles.themeIcons} aria-hidden="true">
      <Sun size={18} className={styles.themeSun} />
      <Moon size={18} className={styles.themeMoon} />
    </span>
  </button>;
}
