'use client';

import { useState } from 'react';
import { CheckIcon, FolderIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/components/assistant-ui/ui/button';
import { Input } from '@/components/assistant-ui/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/assistant-ui/ui/dialog';
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
  const run = async (task: () => Promise<void>) => {
    if (pending) return;
    setPending(true); setError(null);
    try { await task(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试'); }
    finally { setPending(false); }
  };
  const title = creating ? '新建项目' : request.kind === 'move' ? '移动到项目' : request.kind === 'rename' ? '重命名项目' : '删除项目？';
  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent portalContainer={portalContainer} overlayClassName="bg-black/25" className="max-w-sm rounded-xl p-5" showCloseButton={!pending}
      onEscapeKeyDown={event => { event.stopPropagation(); if (pending) event.preventDefault(); }}>
      <DialogTitle>{title}</DialogTitle>
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
        <Button variant="ghost" disabled={pending} onClick={onClose}>取消</Button>
        <Button variant="destructive" disabled={pending} onClick={() => { void run(() => onUpdate(request.project, 'delete')); }}>{pending ? '正在删除…' : '删除项目'}</Button>
      </div> : <form className="grid gap-4" onSubmit={event => {
        event.preventDefault();
        if (!name.trim()) return;
        void run(() => creating ? onCreate(name.trim(), request.kind === 'move' ? request.record.id : undefined)
          : request.kind === 'rename' ? onUpdate(request.project, 'rename', name.trim()) : Promise.resolve());
      }}>
        <Input aria-label="项目名称" autoFocus maxLength={80} placeholder="例如：圆锥曲线" value={name} disabled={pending} onChange={event => setName(event.target.value)} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={() => request.kind === 'move' ? setCreating(false) : onClose()}>{request.kind === 'move' ? '返回' : '取消'}</Button>
          <Button type="submit" disabled={pending || !name.trim() || request.kind === 'rename' && name.trim() === request.project.name}>{pending ? '正在保存…' : creating ? '创建' : '保存'}</Button>
        </div>
      </form>}
      {error && <p role="alert" className="text-sm text-[var(--mm-text-amber-900)]">{error}</p>}
    </DialogContent>
  </Dialog>;
}
