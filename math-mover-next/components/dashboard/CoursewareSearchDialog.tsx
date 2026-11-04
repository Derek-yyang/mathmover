'use client';

import { useMemo, useState } from 'react';
import { Presentation, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/assistant-ui/ui/dialog';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/assistant-ui/ui/command';
import type { CoursewareProject, CoursewareSummary } from '@/lib/courseware-client';

export default function CoursewareSearchDialog({ records, projects, loading, error, disabled, returnFocus, onClose, onRetry, onSelect }: {
  records: CoursewareSummary[]; projects: CoursewareProject[]; loading: boolean; error: string | null; disabled: boolean;
  returnFocus: HTMLElement | null; onClose: () => void; onRetry: () => void; onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return records.filter(record => !record.archived_at && (!search || (record.title || '未命名课件').toLocaleLowerCase().includes(search)))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }, [records, query]);
  const projectNames = new Map(projects.map(project => [project.id, project.name]));

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent showCloseButton={false} overlayClassName="bg-black/25"
      className="flex w-[calc(100vw-2rem)] max-w-[640px] flex-col gap-0 overflow-hidden rounded-2xl border-0 bg-[var(--mm-surface)] p-0 text-[var(--mm-text-stone-800)] sm:rounded-2xl"
      onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); }}>
      <DialogTitle className="sr-only">搜索课件</DialogTitle>
      <DialogDescription className="sr-only">按课件名称搜索，使用上下方向键选择，按 Enter 打开课件。</DialogDescription>
      <Command shouldFilter={false} className="rounded-none bg-transparent [&_[cmdk-input-wrapper]]:border-0 [&_[cmdk-input-wrapper]]:px-5">
        <CommandInput autoFocus value={query} onValueChange={setQuery} aria-label="搜索课件标题" placeholder="搜索课件…"
          className="h-16 rounded-none pr-10 text-base placeholder:text-[var(--mm-text-stone-600)]" />
        <CommandList aria-label="课件搜索结果" className="h-80 max-h-[calc(100dvh-10rem)] px-3 pb-3">
          {loading ? <div role="status" className="space-y-3 px-3 py-4" aria-label="正在加载课件">
            {[0, 1, 2, 3].map(index => <div key={index} className="h-9 animate-pulse rounded-lg bg-[var(--mm-bg-stone-100)] motion-reduce:animate-none" />)}
          </div> : error ? <div role="alert" className="px-3 py-8 text-sm text-[var(--mm-text-stone-600)]">
            <p>{error}</p><button type="button" onClick={onRetry} className="mt-3 rounded text-[var(--mm-text-emerald-700)] underline focus-visible:outline-2 focus-visible:outline-ring">重试</button>
          </div> : <>
            <CommandEmpty className="px-3 py-12 text-sm text-[var(--mm-text-stone-600)]">{query.trim() ? '没有找到匹配的课件' : '暂无课件'}</CommandEmpty>
            <CommandGroup heading={query.trim() ? '搜索结果' : '最近课件'} className="p-0 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-2">
              {matches.map(record => <CommandItem key={record.id} value={record.id} disabled={disabled}
                onSelect={() => onSelect(record.id)} className="min-h-12 cursor-pointer gap-3 rounded-lg px-3 py-2.5 text-sm data-[selected=true]:bg-[var(--mm-bg-stone-100)]">
                <Presentation aria-hidden className="text-[var(--mm-text-stone-500)]" />
                <span className="min-w-0 flex-1 truncate">{record.title || '未命名课件'}</span>
                {record.project_id && projectNames.has(record.project_id) && <span className="max-w-32 truncate text-xs text-[var(--mm-text-stone-600)]">{projectNames.get(record.project_id)}</span>}
              </CommandItem>)}
            </CommandGroup>
          </>}
        </CommandList>
      </Command>
      {disabled && <p role="status" className="px-6 pb-4 text-xs text-[var(--mm-text-stone-600)]">请等待当前操作完成后打开课件。</p>}
      <DialogClose aria-label="关闭搜索" className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-lg text-[var(--mm-text-stone-500)] hover:bg-[var(--mm-bg-stone-100)] focus-visible:outline-2 focus-visible:outline-ring">
        <X aria-hidden className="size-4" />
      </DialogClose>
    </DialogContent>
  </Dialog>;
}
