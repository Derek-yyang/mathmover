'use client';

import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/assistant-ui/ui/dropdown-menu';
import styles from '@/app/landing.module.css';

const choices = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
];
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  // Storage is unavailable on the server; keep the first render identical.
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const selected = mounted ? choices.find(choice => choice.value === theme) : undefined;
  const Icon = selected?.icon ?? Sun;

  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <button type="button" className={styles.themeTrigger} disabled={!mounted}
        aria-label={`切换主题${selected ? `，当前：${selected.label}` : ''}`}
        title="切换主题">
        <Icon size={18} aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" loop className={styles.themeMenu} aria-label="主题模式">
      <DropdownMenuRadioGroup value={selected?.value} onValueChange={setTheme}>
        {choices.map(({ value, label, icon: ChoiceIcon }) => <DropdownMenuRadioItem key={value} value={value} className={styles.themeChoice}>
          <ChoiceIcon size={16} aria-hidden="true" />{label}
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
