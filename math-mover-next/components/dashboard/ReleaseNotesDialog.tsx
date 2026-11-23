'use client';

import { useRef } from 'react';
import { History, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/assistant-ui/ui/dialog';
import releases from '../../../desktop/release-notes.json';
import { acknowledgeReleaseNotes } from '@/lib/release-notes';

export const hasReleaseNotes = (version: string) => releases.some(release => release.version === version);

export function ReleaseNotesDialog({ open, onOpenChange, version }: {
  open: boolean; onOpenChange: (open: boolean) => void; version: string;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const index = releases.findIndex(release => release.version === version);
  const visibleReleases = index >= 0 ? releases.slice(index) : releases.filter(release =>
    release.version.localeCompare(version, undefined, { numeric: true }) <= 0);
  const changeOpen = (next: boolean) => {
    if (!next) acknowledgeReleaseNotes(version);
    onOpenChange(next);
  };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogContent data-slot="release-notes-dialog" overlayClassName="bg-black/35"
      onOpenAutoFocus={event => {
        event.preventDefault();
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        titleRef.current?.focus();
      }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true });
      }}
      className="flex max-h-[min(80dvh,720px)] w-[calc(100vw-32px)] max-w-[560px] flex-col gap-0 overflow-hidden rounded-xl border-0 bg-[var(--mm-surface)] p-0 text-[var(--mm-text-stone-800)] shadow-lg sm:rounded-xl">
      <header className="shrink-0 px-6 pb-4 pt-6 sm:px-7">
        <DialogTitle ref={titleRef} tabIndex={-1} className="flex items-center gap-2 text-lg tracking-normal outline-none"><History size={20} aria-hidden="true" />MathMover 有哪些新变化</DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-6 text-[var(--mm-text-stone-600)]">看看最近的新增功能、体验优化与问题修复。</DialogDescription>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 sm:px-7" tabIndex={0} aria-label="版本更新记录">
        {visibleReleases.map(release => <section key={release.version} aria-label={`版本 ${release.version}`} className="pt-5 first:pt-2 [&+section]:mt-5 [&+section]:border-t [&+section]:border-[var(--mm-border-divider)]">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-sm font-semibold tabular-nums">v{release.version}</h3>
            {release.version === version && <span className="rounded bg-[var(--mm-bg-emerald-50)] px-1.5 py-0.5 text-[11px] text-[var(--mm-text-emerald-700)]">当前版本</span>}
            <a href={`https://github.com/Derek-yyang/mathmover/releases/tag/v${release.version}`} target="_blank" rel="noopener noreferrer" aria-label={`查看 v${release.version} 更新详情`}
              className="ml-auto inline-flex items-center gap-1 rounded-sm text-xs text-[var(--mm-text-stone-600)] hover:text-[var(--mm-text-emerald-700)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]">详情<ExternalLink size={12} aria-hidden="true" /></a>
          </div>
          <ul className="space-y-3">
            {release.items.map(item => <li key={item.text} className="flex items-start gap-2.5 text-sm leading-6">
              <span className={`mt-0.5 shrink-0 rounded px-1.5 text-[11px] leading-5 ${item.kind === '新增' ? 'bg-[var(--mm-bg-emerald-50)] text-[var(--mm-text-emerald-700)]' : 'bg-[var(--mm-bg-stone-100)] text-[var(--mm-text-stone-600)]'}`}>{item.kind}</span>
              <span>{item.text}</span>
            </li>)}
          </ul>
        </section>)}
        {visibleReleases.length === 0 && <p className="py-5 text-sm text-[var(--mm-text-stone-600)]">此版本暂无本地更新记录，可查看完整更新内容。</p>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-[var(--mm-border-divider)] px-6 py-4 sm:px-7">
        <a href="https://github.com/Derek-yyang/mathmover/releases" target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 py-2 text-xs text-[var(--mm-text-stone-600)] transition-colors hover:bg-[var(--mm-bg-stone-100)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]">查看完整更新内容<ExternalLink size={12} aria-hidden="true" /></a>
        <button type="button" onClick={() => changeOpen(false)} className="min-h-9 rounded-md bg-[var(--mm-bg-emerald-700)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--mm-bg-emerald-800)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)]">知道了</button>
      </footer>
    </DialogContent>
  </Dialog>;
}
