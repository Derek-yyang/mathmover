'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { MoreHorizontal } from 'lucide-react';
import { desktopBridge, type DesktopAction } from '@/lib/desktop-bridge';
import { UpdateStatusButton } from './UpdateStatusButton';
import { DesktopAboutDialog } from './DesktopAboutDialog';

const MENU: Array<{ action: DesktopAction; label: string }> = [
  { action: 'check-updates', label: '检查更新…' },
  { action: 'open-logs', label: '打开日志目录' },
  { action: 'copy-diagnostics', label: '复制诊断信息' },
  { action: 'about', label: '关于 MathMover' },
];

/** 从 computed style 的 rgb()/rgba() 取遮罩颜色；解析失败返回 null。 */
function parseOverlayColor(value: string) {
  const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(value);
  if (!match) return null;
  return {
    r: Number(match[1]), g: Number(match[2]), b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

let colorProbe: CanvasRenderingContext2D | null = null;

/**
 * 取遮罩的实际颜色。Tailwind 4 会把 `bg-[var(--x)]/40` 算成 oklab()，
 * 正则解析不了；画到 1px canvas 上再读像素最稳。
 */
function readOverlayColor(element: HTMLElement) {
  const value = getComputedStyle(element).backgroundColor;
  try {
    colorProbe ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (colorProbe) {
      colorProbe.clearRect(0, 0, 1, 1);
      colorProbe.fillStyle = 'rgba(0, 0, 0, 0)';
      colorProbe.fillStyle = value;
      if (colorProbe.fillStyle !== 'rgba(0, 0, 0, 0)') {
        colorProbe.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = colorProbe.getImageData(0, 0, 1, 1).data;
        return { r, g, b, a: Number((a / 255).toFixed(3)) };
      }
    }
  } catch {
    // canvas 被禁用时退回正则
  }
  return parseOverlayColor(value);
}

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
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // 原生窗口按钮/边框跟随应用主题（浅色 → 浅灰按钮，深色 → 深色）
  useEffect(() => {
    if (!enabled) return;
    desktopBridge()?.setTitleBarTheme(resolvedTheme === 'dark' ? 'dark' : 'light');
  }, [enabled, resolvedTheme]);

  // 模态打开时网页遮罩盖不到 Windows 的原生按钮区，把它一起压暗。
  // 两套 Dialog 实现的遮罩都带 data-mm-modal-overlay；颜色从元素上读，
  // 不同弹窗的遮罩透明度不同（35%–80%），主进程按实际颜色做预混合。
  useEffect(() => {
    if (!enabled) return;
    const bridge = desktopBridge();
    if (!bridge) return;
    let appliedKey: string | null = null;
    let lastOverlay: Element | null = null;
    let lastTheme: string | null = null;
    const sync = () => {
      const overlay = document.querySelector('[data-mm-modal-overlay]');
      const theme = document.documentElement.dataset.theme || 'light';
      // 遮罩与主题都没变就不重算（聊天流式输出会频繁触发 body 变更）
      if (overlay === lastOverlay && theme === lastTheme) return;
      lastOverlay = overlay;
      lastTheme = theme;
      const color = overlay instanceof HTMLElement ? readOverlayColor(overlay) : null;
      const key = color ? JSON.stringify(color) : overlay ? 'fallback' : null;
      if (key === appliedKey) return;
      appliedKey = key;
      if (!overlay) bridge.setTitleBarModal?.(false);
      else bridge.setTitleBarModal?.(true, color ?? undefined);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [enabled]);

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
    <><header
      className="desktop-titlebar fixed inset-x-0 top-0 z-40 flex h-10 select-none items-center gap-2 border-b border-[var(--mm-border-divider)] bg-[var(--mm-canvas-shell)] pl-3 pr-[150px]"
      data-slot="desktop-titlebar"
    >
      <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--mm-bg-emerald-600)] text-[10px] font-bold leading-none text-white">M</span>
      <span className="truncate text-[13px] font-semibold text-[var(--mm-text-stone-900)]">MathMover</span>
      <span className="hidden text-[11px] text-[var(--mm-text-stone-400)] md:inline">桌面版</span>

      <div ref={menuRef} className="desktop-titlebar-menu relative ml-auto">
        <button
          ref={menuButtonRef}
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

      <UpdateStatusButton />
    </header>
    <DesktopAboutDialog returnFocusRef={menuButtonRef} /></>
  );
}
