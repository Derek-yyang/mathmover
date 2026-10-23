'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { desktopBridge, type UpdateState } from '@/lib/desktop-bridge';

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const ICON_BUTTON = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--mm-border-emerald-700)]';

/**
 * 标题栏里的更新状态环：不打断操作，状态自己说话。
 *
 *   idle        不渲染
 *   downloading 圆环按百分比走，hover 看进度
 *   ready       重启按钮，点开就地确认（不弹系统模态）
 *   failed      警示图标，点击重试
 *
 * 状态由主进程推送（Windows 的 electron-updater 与 macOS 的 Sparkle 共用一条通道）。
 */
export function UpdateStatusButton() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    let active = true;
    // 页面加载与订阅之间有窗口期，先拉一次当前状态。
    bridge.getUpdateState?.().then(next => { if (active && next) setState(next); }).catch(() => {});
    const unsubscribe = bridge.onUpdateState?.(next => setState(next));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof PointerEvent && anchorRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (state.status === 'idle') return null;

  if (state.status === 'downloading') {
    const percent = Math.max(0, Math.min(100, Math.round(state.percent)));
    const label = `正在下载更新 ${percent}%`;
    return (
      <span role="img" aria-label={label} title={label} className="flex h-7 w-7 shrink-0 items-center justify-center">
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r={RADIUS} fill="none" stroke="var(--mm-border-divider)" strokeWidth="2" />
          <circle
            cx="10" cy="10" r={RADIUS} fill="none"
            stroke="var(--mm-bg-emerald-600)" strokeWidth="2" strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
            transform="rotate(-90 10 10)"
            style={{ transition: 'stroke-dashoffset 200ms ease' }}
          />
        </svg>
      </span>
    );
  }

  if (state.status === 'failed') {
    return (
      <button
        type="button"
        aria-label="更新下载失败，点击重试"
        title="更新下载失败，点击重试"
        onClick={() => {
          // 立即收起，避免重试期间图标停留；主进程失败会再推回 failed。
          setState({ status: 'idle' });
          desktopBridge()?.action('retry-update');
        }}
        className={`${ICON_BUTTON} text-[var(--mm-text-amber-500)] hover:bg-[var(--mm-bg-stone-100)]`}
      >
        <TriangleAlert aria-hidden size={15} />
      </button>
    );
  }

  const version = state.version || '新版';
  return (
    <div ref={anchorRef} className="desktop-update relative shrink-0">
      <button
        type="button"
        aria-label={`${version} 已就绪，重启应用即可完成更新`}
        title={`${version} 已就绪，点击重启更新`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={`${ICON_BUTTON} text-[var(--mm-text-emerald-700)] hover:bg-[var(--mm-bg-emerald-50)]`}
      >
        <RotateCw aria-hidden size={15} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="更新已就绪"
          className="desktop-update-popover absolute left-0 top-8 z-50 w-60 rounded-lg border border-[var(--mm-border-divider)] bg-[var(--mm-surface)] p-3 text-left shadow-[0_2px_8px_rgb(28_25_23_/_0.10)]"
        >
          <p className="text-[12px] font-semibold text-[var(--mm-text-stone-900)]">MathMover {version} 已就绪</p>
          <p className="mt-1 text-[11px] leading-5 text-[var(--mm-text-stone-500)]">
            重启应用完成更新；不重启的话，退出时也会自动安装。课件与设置会保留。
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-[12px] text-[var(--mm-text-stone-600)] transition-colors hover:bg-[var(--mm-bg-stone-100)] hover:text-[var(--mm-text-stone-900)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--mm-border-emerald-700)]"
            >
              稍后
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                desktopBridge()?.action('restart-update');
              }}
              className="rounded-md bg-[var(--mm-bg-emerald-600)] px-2 py-1 text-[12px] font-medium text-white transition-colors hover:bg-[var(--mm-bg-emerald-500)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--mm-border-emerald-700)]"
            >
              立即重启
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
