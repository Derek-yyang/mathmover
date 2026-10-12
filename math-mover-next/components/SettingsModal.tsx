'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import AgentSettings from './settings/AgentSettings';
import ByokSettings from './settings/ByokSettings';

const quietButton = 'rounded-lg px-3 py-2 text-sm font-medium hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); trigger?.focus(); };
  }, []);

  return <dialog ref={dialogRef} aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }} className="settings-dialog m-auto h-[640px] max-h-[90dvh] w-[840px] max-w-[calc(100%-32px)] overflow-hidden rounded-2xl bg-[#FDFCF8] p-0 text-stone-800 shadow-2xl backdrop:bg-stone-900/40">
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-stone-200 px-6 py-4">
        <h2 id="settings-title" className="text-lg font-semibold">设置</h2>
        <button type="button" aria-label="关闭设置" onClick={onClose} className={quietButton}><X className="h-5 w-5" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <AgentSettings />
        <ByokSettings />
      </div>
    </div>
  </dialog>;
}
