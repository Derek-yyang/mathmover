'use client';

import { useId, useState } from 'react';
import { CheckIcon, FolderIcon, PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/assistant-ui/ui/button';
import { Input } from '@/components/assistant-ui/ui/input';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/assistant-ui/ui/dialog';
import type { CoursewareProject, CoursewareSummary } from '@/lib/courseware-client';

export type OrganizationRequest =
  | { kind: 'create' }
  | { kind: 'move'; record: CoursewareSummary }
  | { kind: 'rename' | 'delete'; project: CoursewareProject };

export default function CoursewareOrganizationDialog({ request, projects, portalContainer, onClose, onCreate, onMove, onUpdate }: {
  request: OrganizationRequest;
  projects: CoursewareProject[];
  portalContainer?: HTMLElement | null;
  onClose: () => void;
  onCreate: (name: string, coursewareId?: string) => Promise<void>;
  onMove: (id: string, projectId: string | null) => Promise<void>;
  onUpdate: (project: CoursewareProject, action: 'rename' | 'delete', name?: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(request.kind === 'create');
  const [name, setName] = useState(request.kind === 'rename' ? request.project.name : '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const actionClass = 'rounded-lg shadow-none motion-reduce:transition-none';
  const run = async (task: () => Promise<void>) => {
    if (pending) return;
    setPending(true); setError(null);
    try { await task(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试'); }
    finally { setPending(false); }
  };
  const title = creating ? '新建项目' : request.kind === 'move' ? '移动到项目' : request.kind === 'rename' ? '重命名项目' : '删除项目？';
  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent portalContainer={portalContainer} overlayClassName="bg-black/25"
      className="w-[calc(100%_-_2rem)] max-w-sm gap-5 rounded-xl border-[var(--mm-border-stone-200)] bg-[var(--mm-surface)] p-6 text-[var(--mm-text-stone-900)] shadow-none sm:rounded-xl" showCloseButton={false}
      onEscapeKeyDown={event => { event.stopPropagation(); if (pending) event.preventDefault(); }}>
      <DialogTitle className="pr-8 text-base leading-6 tracking-normal">{title}</DialogTitle>
      <DialogClose aria-label="关闭" disabled={pending}
        className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg text-[var(--mm-text-stone-600)] transition-colors hover:bg-[var(--mm-bg-stone-100)] hover:text-[var(--mm-text-stone-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none">
        <XIcon aria-hidden className="size-4" />
      </DialogClose>
      <DialogDescription className={request.kind === 'delete' || request.kind === 'move' && !creating ? undefined : 'sr-only'}>
        {request.kind === 'delete' ? `“${request.project.name}”中的课件会保留，并回到最近课件。`
          : request.kind === 'move' ? `整理“${request.record.title || '未命名课件'}”` : '输入项目名称。'}
      </DialogDescription>
      {request.kind === 'move' && !creating ? <div className="-mx-1 max-h-72 overflow-y-auto">
        {[{ id: null, name: '不属于项目' }, ...projects].map(project => <button key={project.id ?? 'ungrouped'} type="button" disabled={pending}
          className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          onClick={() => { void run(() => onMove(request.record.id, project.id)); }}>
          <FolderIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{project.name}</span>
          {(request.record.project_id ?? null) === project.id && <CheckIcon aria-label="当前项目" className="size-4 text-[var(--mm-text-emerald-700)]" />}
        </button>)}
        <button type="button" disabled={pending} className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden className="size-4" />新建项目
        </button>
      </div> : request.kind === 'delete' ? <div className="flex justify-end gap-2">
        <Button className={actionClass} variant="ghost" disabled={pending} onClick={onClose}>取消</Button>
        <Button className={actionClass} variant="destructive" disabled={pending} onClick={() => { void run(() => onUpdate(request.project, 'delete')); }}>{pending ? '正在删除…' : '删除项目'}</Button>
      </div> : <form className="grid gap-5" onSubmit={event => {
        event.preventDefault();
        if (!name.trim()) return;
        void run(() => creating ? onCreate(name.trim(), request.kind === 'move' ? request.record.id : undefined)
          : request.kind === 'rename' ? onUpdate(request.project, 'rename', name.trim()) : Promise.resolve());
      }}>
        <div className="grid gap-1.5">
          <label htmlFor={nameId} className="text-xs font-medium leading-5 text-[var(--mm-text-stone-700)]">项目名称</label>
          <Input id={nameId} autoFocus maxLength={80} placeholder="例如：圆锥曲线" value={name} disabled={pending} onChange={event => setName(event.target.value)}
            className="h-10 rounded-lg border-[var(--mm-border-stone-300)] bg-[var(--mm-surface)] text-sm shadow-none focus-visible:border-[var(--mm-border-emerald-700)] focus-visible:ring-0 motion-reduce:transition-none" />
        </div>
        <div className="flex justify-end gap-2">
          <Button className={`${actionClass} text-[var(--mm-text-stone-700)]`} type="button" variant="ghost" disabled={pending} onClick={() => request.kind === 'move' ? setCreating(false) : onClose()}>{request.kind === 'move' ? '返回' : '取消'}</Button>
          <Button className={actionClass} type="submit" disabled={pending || !name.trim() || request.kind === 'rename' && name.trim() === request.project.name}>{pending ? '正在保存…' : creating ? '创建' : '保存'}</Button>
        </div>
      </form>}
      {error && <p role="alert" className="text-sm text-[var(--mm-text-amber-900)]">{error}</p>}
    </DialogContent>
  </Dialog>;
}
