'use client';

import { useEffect, useId, useState, type RefObject } from 'react';
import { Check, ChevronDown, Copy, ExternalLink, FolderOpen, Globe, RotateCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/assistant-ui/ui/dialog';
import { desktopBridge, type DesktopAboutInfo } from '@/lib/desktop-bridge';

const CONTROL = 'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--mm-bg-stone-100)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)] motion-reduce:transition-none';

/** 所有桌面入口共用；版本和诊断内容由主进程提供，不在页面里写死。 */
export function DesktopAboutDialog({ returnFocusRef }: { returnFocusRef: RefObject<HTMLButtonElement | null> }) {
  const [info, setInfo] = useState<DesktopAboutInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const detailsId = useId();

  useEffect(() => desktopBridge()?.onShowAbout?.(next => {
    setInfo(next);
    setExpanded(false);
    setCopied(false);
    setOpen(true);
  }), []);

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent
      className="max-h-[calc(100dvh-48px)] w-[calc(100vw-32px)] max-w-[440px] gap-0 overflow-y-auto rounded-xl border-0 bg-[var(--mm-surface)] p-0 text-[var(--mm-text-stone-800)] shadow-lg sm:rounded-xl"
      overlayClassName="bg-black/35"
      onCloseAutoFocus={event => {
        event.preventDefault();
        returnFocusRef.current?.focus();
      }}
    >
      <div className="px-7 pb-6 pt-8">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-[var(--mm-bg-emerald-700)] text-3xl font-bold leading-none text-white">M</span>
          <div>
            <DialogTitle className="text-[22px] leading-7 tracking-normal"><span className="sr-only">关于 </span>MathMover</DialogTitle>
            <p className="mt-1 text-xs text-[var(--mm-text-stone-600)]">桌面版 <span className="ml-1 tabular-nums">{info?.version}</span></p>
          </div>
        </div>
        <DialogDescription className="mt-5 text-sm leading-6 text-[var(--mm-text-stone-600)]">让数学问题成为可探索的图形。</DialogDescription>
        <div className="mt-5 flex flex-wrap items-center gap-1">
          <a className={`${CONTROL} -ml-3`} href="https://mathmover.top" target="_blank" rel="noopener noreferrer">
            <Globe size={15} aria-hidden="true" />官网<ExternalLink size={12} aria-hidden="true" />
          </a>
          <a className={CONTROL} href="https://github.com/Derek-yyang/mathmover" target="_blank" rel="noopener noreferrer">
            GitHub<ExternalLink size={12} aria-hidden="true" />
          </a>
          <button type="button" className={`${CONTROL} ml-auto text-[var(--mm-text-emerald-700)]`} onClick={() => {
            setOpen(false);
            desktopBridge()?.action('check-updates');
          }}><RotateCw size={15} aria-hidden="true" />检查更新</button>
        </div>
      </div>

      <div className="border-t border-[var(--mm-border-divider)] px-7 py-4">
        <button type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(value => !value)}
          className="flex w-full items-center justify-between rounded-sm py-1 text-xs font-medium text-[var(--mm-text-stone-600)] transition-colors hover:text-[var(--mm-text-stone-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)] motion-reduce:transition-none">
          诊断信息<ChevronDown size={14} aria-hidden="true" className={`transition-transform duration-200 motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <div id={detailsId} inert={!expanded} aria-hidden={!expanded} className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="relative min-h-0 overflow-hidden">
            <pre className="mt-3 max-h-44 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-[var(--mm-bg-stone-100)] p-3 font-mono text-[11px] leading-5 text-[var(--mm-text-stone-600)]">{info?.diagnostics}</pre>
            <div className="mt-2 flex flex-wrap items-center gap-1 text-[var(--mm-text-stone-600)]">
              <button type="button" className={`${CONTROL} -ml-3 text-xs`} onClick={() => {
                desktopBridge()?.action('copy-diagnostics');
                setCopied(true);
              }}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? '已复制' : '复制信息'}</button>
              <span role="status" className="sr-only">{copied ? '诊断信息已复制' : ''}</span>
              <button type="button" className={`${CONTROL} text-xs`} onClick={() => desktopBridge()?.action('open-logs')}><FolderOpen size={14} aria-hidden="true" />打开日志目录</button>
            </div>
          </div>
        </div>
      </div>
      <p className="px-7 pb-5 text-[11px] text-[var(--mm-text-stone-600)]">开源软件 · <a href="https://github.com/Derek-yyang/mathmover/blob/master/LICENSE" target="_blank" rel="noopener noreferrer" className="rounded-sm underline decoration-[var(--mm-border-stone-300)] underline-offset-4 hover:text-[var(--mm-text-stone-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)]">MIT License</a></p>
    </DialogContent>
  </Dialog>;
}
