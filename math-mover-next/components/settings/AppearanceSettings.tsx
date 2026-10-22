'use client';

import { useEffect, useId, useState } from 'react';
import { ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/assistant-ui/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/assistant-ui/ui/dropdown-menu';
import { desktopBridge, type DesktopPreferences } from '@/lib/desktop-bridge';

const choices = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
];

export default function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  return <>
    <AppearanceSettingsView theme={theme} setTheme={setTheme} />
    <DesktopWindowSettings />
  </>;
}

/** 真实桌面壳的设置；首页复用的 AppearanceSettingsView 不包含此项。 */
function DesktopWindowSettings() {
  const descriptionId = useId();
  const [state, setState] = useState<{ preferences: DesktopPreferences | null; error: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    let active = true;
    bridge.getPreferences().then(preferences => {
      if (active) setState({ preferences, error: '' });
    }).catch(() => {
      if (active) setState({ preferences: null, error: '无法读取窗口设置，请重新打开设置后重试。' });
    });
    return () => { active = false; };
  }, []);

  async function changeCloseToTray(enabled: boolean) {
    const bridge = desktopBridge();
    if (!bridge || saving) return;
    setSaving(true);
    try {
      const preferences = await bridge.setCloseToTray(enabled);
      setState({ preferences, error: '' });
    } catch {
      setState(previous => ({ preferences: previous?.preferences ?? null, error: '保存失败，请重试。' }));
    } finally {
      setSaving(false);
    }
  }

  if (!state) return null;
  const { preferences, error } = state;
  return <section className="mt-8 border-t border-[var(--mm-border-divider)] pt-6">
    <h3 className="text-base font-semibold text-[var(--mm-text-stone-900)]">窗口行为</h3>
    <label className="mt-5 flex items-center justify-between gap-4 text-sm font-medium text-[var(--mm-text-stone-900)]">
      关闭窗口时收起到托盘
      <input type="checkbox" role="switch" className="size-4 shrink-0 cursor-pointer accent-[var(--mm-text-emerald-700)] disabled:cursor-not-allowed disabled:opacity-50"
        checked={preferences?.closeToTray ?? false} disabled={saving || !preferences?.trayAvailable}
        aria-describedby={descriptionId} onChange={event => { void changeCloseToTray(event.target.checked); }} />
    </label>
    <p id={descriptionId} className="mt-2 text-sm leading-6 text-[var(--mm-text-stone-600)]">
      {preferences && !preferences.trayAvailable ? '系统托盘当前不可用，关闭窗口时将退出应用。' : '开启后，关闭窗口仍会在后台运行。点击托盘图标可恢复窗口，右键选择“退出”可完全关闭应用。'}
    </p>
    {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
  </section>;
}

export function AppearanceSettingsView({ theme, setTheme }: { theme?: string; setTheme: (theme: string) => void }) {
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
