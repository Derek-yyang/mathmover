'use client';

import { useEffect, useId, useState } from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { desktopBridge, type DesktopPreferences } from '@/lib/desktop-bridge';

const choices = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
] as const;

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
  const groupName = useId();
  // The saved theme is only available on the client; keep SSR and hydration identical.
  const [mountedElement, setMountedElement] = useState<HTMLDivElement | null>(null);
  return <div ref={setMountedElement}>
    <h3 className="text-base font-semibold text-[var(--mm-text-stone-900)]">外观</h3>
    <p className="mt-1 text-sm leading-6 text-[var(--mm-text-stone-600)]">选择工作台的界面颜色。课件画板会保留原有背景与图形颜色，方便继续编辑和导出。</p>
    <fieldset className="mt-6 min-w-0">
      <legend className="text-sm font-medium text-[var(--mm-text-stone-900)]">主题模式</legend>
      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,130px),1fr))] gap-3">
        {choices.map(({ value, label, icon: Icon }) => <label key={value} className="group relative min-w-0 cursor-pointer">
          <input type="radio" name={groupName} value={value} checked={!!mountedElement && theme === value}
            disabled={!mountedElement} onChange={() => setTheme(value)} className="peer sr-only" />
          <span className="block overflow-hidden rounded-xl border border-[var(--mm-border-stone-200)] p-2 transition-colors duration-150 group-hover:border-[var(--mm-border-stone-400)] peer-checked:border-[var(--mm-text-emerald-700)] peer-checked:bg-[var(--mm-bg-emerald-50)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-[var(--mm-text-emerald-700)] peer-disabled:opacity-50 motion-reduce:transition-none">
            <ThemePreview mode={value} />
            <span className="mt-3 mb-1 flex items-center gap-2 px-1 text-sm font-medium text-[var(--mm-text-stone-900)]">
              <Icon aria-hidden className="size-4 shrink-0 text-[var(--mm-text-stone-600)]" />
              {label}
              <span aria-hidden className={`ml-auto flex size-4 shrink-0 items-center justify-center rounded-full ${mountedElement && theme === value ? 'bg-[var(--mm-text-emerald-700)] text-[var(--mm-surface)]' : ''}`}>
                {mountedElement && theme === value && <Check className="size-3" strokeWidth={2.5} />}
              </span>
            </span>
          </span>
        </label>)}
      </div>
    </fieldset>
  </div>;
}

/** Decorative workbench thumbnails keep the white GeoGebra canvas in both themes. */
function ThemePreview({ mode }: { mode: typeof choices[number]['value'] }) {
  return <span aria-hidden className="relative block aspect-[1.55] overflow-hidden rounded-md">
    {mode === 'system'
      ? <><WorkbenchPreview dark={false} /><span className="absolute inset-0" style={{ clipPath: 'inset(0 0 0 50%)' }}><WorkbenchPreview dark /></span></>
      : <WorkbenchPreview dark={mode === 'dark'} />}
  </span>;
}

function WorkbenchPreview({ dark }: { dark: boolean }) {
  const surface = dark ? '#242927' : '#f5f5f4';
  const ink = dark ? '#a4ada8' : '#b8bcb9';
  return <svg className="block size-full" viewBox="0 0 200 130" preserveAspectRatio="none" fill="none">
    <rect width="200" height="130" fill={surface} />
    <rect x="9" y="10" width="9" height="9" rx="3" fill="#419a77" />
    <path d="M24 14.5H51M9 36H39M9 47H32M9 70H38M9 80H31" stroke={ink} strokeWidth="3" strokeLinecap="round" />
    <rect x="5" y="52" width="44" height="10" rx="3" fill={dark ? '#355246' : '#d8eee2'} />
    <path d="M10 57H37" stroke="#419a77" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M61 14.5H93" stroke={ink} strokeWidth="3" strokeLinecap="round" />
    <rect x="174" y="10" width="17" height="8" rx="3" fill="#419a77" />
    <rect x="58" y="27" width="96" height="95" rx="4" fill="#fff" stroke="#d9ddd9" />
    <path d="M77 28V121M96 28V121M115 28V121M134 28V121M59 46H153M59 65H153M59 84H153M59 103H153" stroke="#eef0ee" />
    <path d="M68 103H144M96 113V37" stroke="#a0a7a2" />
    <path d="M72 102Q107 15 139 102" stroke="#419a77" strokeWidth="2.5" />
    <circle cx="116" cy="63" r="3.5" fill="#419a77" />
    <path d="M165 36H187M165 44H182M165 57H189M165 65H184" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
    <rect x="162" y="99" width="31" height="23" rx="4" fill={dark ? '#353d38' : '#fff'} />
  </svg>;
}
