'use client';

import { useState } from 'react';
import { ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/assistant-ui/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/assistant-ui/ui/dropdown-menu';

const choices = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
];

export default function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  // Keep the menu inside Settings' focus scope. The mounted container
  // also guards theme-dependent content until hydration has completed.
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const selected = portalContainer ? choices.find(choice => choice.value === theme) : undefined;
  const Icon = selected?.icon ?? Monitor;
  return <div ref={setPortalContainer}>
    <h3 className="text-base font-semibold text-[var(--mm-text-stone-900)]">外观</h3>
    <p className="mt-1 text-sm leading-6 text-[var(--mm-text-stone-600)]">选择工作台的界面颜色。课件画板会保留原有背景与图形颜色，方便继续编辑和导出。</p>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <span id="theme-mode-label" className="text-sm font-medium text-[var(--mm-text-stone-900)]">主题模式</span>
      {/* Settings already owns modal focus/scroll locking. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" disabled={!portalContainer} aria-labelledby="theme-mode-label theme-mode-value" className="min-w-36 justify-start motion-reduce:transition-none">
            <Icon aria-hidden />
            <span id="theme-mode-value">{selected?.label ?? '选择主题'}</span>
            <ChevronDown aria-hidden className="ml-auto text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" loop portalContainer={portalContainer} className="min-w-40" aria-label="主题模式">
          <DropdownMenuRadioGroup value={selected?.value} onValueChange={setTheme}>
            {choices.map(({ value, label, icon: ChoiceIcon }) => <DropdownMenuRadioItem key={value} value={value}>
              <ChoiceIcon aria-hidden className="size-4 text-muted-foreground" />{label}
            </DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>;
}
