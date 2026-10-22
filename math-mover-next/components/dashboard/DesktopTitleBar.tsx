'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { MoreHorizontal } from 'lucide-react';
import { desktopBridge, type DesktopAction } from '@/lib/desktop-bridge';

const MENU: Array<{ action: DesktopAction; label: string }> = [
  { action: 'check-updates', label: '检查更新…' },
  { action: 'open-logs', label: '打开日志目录' },
  { action: 'copy-diagnostics', label: '复制诊断信息' },
  { action: 'about', label: '关于 MathMover' },
];

/**
 * 桌面端的自定义标题栏。
 *
 * 只在桌面构建里渲染（`MATHMOVER_DESKTOP=1` 在构建时注入）；整条是窗口拖拽区，
 * 右侧留出原生窗口按钮（titleBarOverlay）的位置。浏览器里返回 null，不影响网页版。
 */
export function DesktopTitleBar({ enabled }: { enabled: boolean }) {
  const { resolvedTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 原生窗口按钮/边框跟随应用主题（浅色 → 浅灰按钮，深色 → 深色）
  useEffect(() => {
    if (!enabled) return;
    desktopBridge()?.setTitleBarTheme(resolvedTheme === 'dark' ? 'dark' : 'light');
  }, [enabled, resolvedTheme]);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof PointerEvent && menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!enabled) return null;

  const run = (action: DesktopAction) => {
    setOpen(false);
    desktopBridge()?.action(action);
  };

  return (
    <header
      className="desktop-titlebar fixed inset-x-0 top-0 z-30 flex h-10 select-none items-center gap-2 border-b border-[var(--mm-border-divider)] bg-[var(--mm-canvas-shell)] pl-3 pr-[150px]"
      data-slot="desktop-titlebar"
    >
      <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--mm-bg-emerald-600)] text-[10px] font-bold leading-none text-white">M</span>
      <span className="truncate text-[13px] font-semibold text-[var(--mm-text-stone-900)]">MathMover</span>
      <span className="hidden text-[11px] text-[var(--mm-text-stone-400)] md:inline">桌面版</span>

      <div ref={menuRef} className="relative ml-auto">
        <button
          type="button"
          aria-label="桌面菜单"
          title="检查更新、日志与关于"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--mm-text-stone-600)] transition-colors hover:bg-[var(--mm-bg-stone-100)] hover:text-[var(--mm-text-stone-900)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--mm-border-emerald-700)]"
        >
          <MoreHorizontal aria-hidden size={16} />
        </button>
        {open && (
          <div
            role="menu"
            aria-label="桌面菜单项"
            className="absolute right-0 top-8 z-50 w-44 overflow-hidden rounded-lg border border-[var(--mm-border-divider)] bg-[var(--mm-surface)] py-1 shadow-[0_2px_8px_rgb(28_25_23_/_0.10)]"
          >
            {MENU.map((item, index) => (
              <button
                key={item.action}
                type="button"
                role="menuitem"
                onClick={() => run(item.action)}
                className={`block w-full px-3 py-1.5 text-left text-[12px] text-[var(--mm-text-stone-700)] transition-colors hover:bg-[var(--mm-bg-stone-100)] hover:text-[var(--mm-text-stone-900)] ${index === MENU.length - 1 ? 'border-t border-[var(--mm-border-divider)]' : ''}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
