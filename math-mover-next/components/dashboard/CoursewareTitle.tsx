'use client';

import { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';

interface Props {
  title: string;
  disabled?: boolean;
  onRename: (title: string) => Promise<void>;
}

export default function CoursewareTitle({ title, disabled, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const close = (returnFocus: boolean) => {
    setEditing(false);
    if (returnFocus) requestAnimationFrame(() => trigger.current?.focus());
  };
  const save = async (returnFocus: boolean) => {
    if (pending.current) return;
    const next = draft.trim();
    if (!next) { setError('请输入课件名称'); input.current?.focus(); return; }
    if (next === title) { close(returnFocus); return; }
    pending.current = true;
    setSaving(true);
    setError(null);
    try { await onRename(next); close(returnFocus); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : '重命名失败，请重试');
      input.current?.focus();
    } finally { pending.current = false; setSaving(false); }
  };

  if (!editing) return <button ref={trigger} type="button" disabled={disabled}
    aria-label={`重命名课件：${title || '未命名课件'}`} title={disabled ? title : '点击编辑课件名称'}
    onClick={() => { setDraft(title); setError(null); setEditing(true); }}
    className="group flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm font-semibold text-stone-800 transition-colors hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:cursor-default disabled:hover:bg-transparent motion-reduce:transition-none">
    <span className="max-w-[200px] truncate">{title || '未命名课件'}</span>
    <Pencil aria-hidden className="h-3 w-3 shrink-0 text-stone-500 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-disabled:invisible" />
  </button>;

  return <form aria-label="编辑课件名称" aria-busy={saving} data-slot="courseware-title-editor"
    className="relative flex w-52 min-w-0 items-center"
    onSubmit={event => { event.preventDefault(); void save(true); }}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) void save(false);
    }}>
    <input ref={input} autoFocus maxLength={200} value={draft} readOnly={saving}
      aria-label="课件名称" aria-invalid={!!error} aria-describedby={error ? 'courseware-title-error' : undefined}
      onFocus={event => event.currentTarget.select()}
      onChange={event => { setDraft(event.target.value); setError(null); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) {
          if (event.key === 'Enter') event.preventDefault();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation();
          if (!pending.current) close(true);
        }
      }}
      className="h-7 w-full min-w-0 select-text rounded-none border-0 border-b border-stone-300 bg-transparent px-1.5 text-sm font-semibold text-stone-800 outline-none focus:border-emerald-600 aria-invalid:border-amber-700" />
    {error && <p id="courseware-title-error" role="alert" className="absolute top-full left-0 z-10 mt-1 w-64 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900 shadow-sm">{error}</p>}
  </form>;
}
