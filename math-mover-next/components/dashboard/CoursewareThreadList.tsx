'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ExternalStoreThreadListAdapter, type ThreadMessageLike } from '@assistant-ui/react';
import { ThreadList } from '@/components/assistant-ui/elements/thread-list.aui';
import { Button } from '@/components/assistant-ui/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/assistant-ui/ui/dialog';
import { archiveCourseware, deleteCoursewares, libraryRequest, renameCourseware, type CoursewareSummary } from '@/lib/courseware-client';
import { useAgentRuntimeState } from './AgentRuntimeState';
import { useSidebarState } from './SidebarState';
import { useNewCourseware } from '@/hooks/useNewCourseware';

const EMPTY_MESSAGES: readonly ThreadMessageLike[] = [];

/** Official list runtime backed by the existing courseware API. Chat and canvas
 * remain owned by useCoursewareLibrary; selecting a row uses its existing URL. */
export default function CoursewareThreadList({ searchRequest = 0, archived = false, active = true, onOpen, onOpenRequest, portalContainer }: {
  searchRequest?: number; archived?: boolean; active?: boolean; onOpen?: () => void; onOpenRequest?: (proceed: () => void) => void; portalContainer?: HTMLElement | null;
}) {
  const router = useRouter();
  const currentId = useSearchParams().get('history_id') ?? undefined;
  const { busy } = useAgentRuntimeState();
  const newCourseware = useNewCourseware();
  const sidebar = useSidebarState();
  const [records, setRecords] = useState<CoursewareSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestVersion = useRef(0);
  const mutationLock = useRef(false);
  const mounted = useRef(false);
  const disabled = busy || mutating;

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const result = await libraryRequest<{ records: CoursewareSummary[] }>('?archived=all');
      if (!mounted.current || version !== requestVersion.current) return;
      setRecords(result.records);
      setError(null);
      setSelectedIds(previous => new Set([...previous].filter(id => result.records.some(record => record.id === id))));
    } catch (cause) {
      if (mounted.current && version === requestVersion.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current && version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    mounted.current = true;
    const changed = () => { void refresh(); };
    changed();
    window.addEventListener('mathmover_coursewares_changed', changed);
    const timer = window.setInterval(changed, 10_000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener('mathmover_coursewares_changed', changed);
    };
  }, [active, refresh]);

  useEffect(() => {
    if (searchRequest && !sidebar?.collapsed) {
      (searchRef.current ?? listRef.current?.querySelector<HTMLButtonElement>('[data-slot=aui_thread-list-new]'))?.focus();
    }
  }, [searchRequest, sidebar?.collapsed]);

  const remove = useCallback(async (ids: string[], reportError = true) => {
    if (busy || mutationLock.current) return;
    mutationLock.current = true;
    setMutating(true);
    try {
      await deleteCoursewares(ids);
      setRecords(previous => previous.filter(record => !ids.includes(record.id)));
      setSelectedIds(new Set());
      setSelectionMode(false);
      setDeleteIds([]);
      setError(null);
      if (currentId && ids.includes(currentId)) router.push('/dashboard?action=new');
    } catch (cause) {
      if (reportError) setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      mutationLock.current = false;
      setMutating(false);
    }
  }, [busy, currentId, router]);

  const threadData = useMemo(() => records.map(record => ({
    id: record.id, remoteId: record.id, status: 'regular' as const,
    title: record.title || '未命名课件',
    archived_at: record.archived_at,
    // The installed external-store core preserves additional state fields.
    lastMessageAt: new Date(record.updated_at),
  })), [records]);
  const threads = useMemo(() => threadData.filter(thread => !thread.archived_at), [threadData]);
  const archivedThreads = useMemo(() => threadData.filter(thread => thread.archived_at).map(thread => ({ ...thread, status: 'archived' as const })), [threadData]);
  const setArchived = useCallback(async (id: string, archived: boolean) => {
    if (busy || mutationLock.current) throw new Error('请等待当前操作完成后归档');
    const record = records.find(record => record.id === id);
    if (!record) throw new Error('课件已不存在，请刷新列表');
    mutationLock.current = true;
    setMutating(true);
    try { await archiveCourseware(id, archived, record.revision); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause; }
    finally { mutationLock.current = false; setMutating(false); }
  }, [busy, records, refresh]);
  const openCourseware = useCallback((id: string) => {
    if (busy || mutationLock.current) return;
    const proceed = () => { router.push(`/dashboard?history_id=${encodeURIComponent(id)}`); onOpen?.(); };
    if (onOpenRequest) onOpenRequest(proceed); else proceed();
  }, [busy, onOpen, onOpenRequest, router]);
  const adapter = useMemo<ExternalStoreThreadListAdapter>(() => ({
    threadId: currentId, threads, archivedThreads, isLoading: loading,
    onSwitchToNewThread: () => { if (!mutationLock.current) newCourseware(); },
    onSwitchToThread: openCourseware,
    onRename: async (id, title) => {
      if (busy || mutationLock.current) throw new Error('请等待当前操作完成后重命名');
      const record = records.find(record => record.id === id);
      if (!record) throw new Error('课件已不存在，请刷新列表');
      mutationLock.current = true;
      setMutating(true);
      try {
        await renameCourseware(id, title, record.revision);
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      } finally { mutationLock.current = false; setMutating(false); }
    },
    onDelete: id => remove([id], false),
    onArchive: id => setArchived(id, true),
    onUnarchive: id => setArchived(id, false),
  }), [archivedThreads, busy, currentId, loading, newCourseware, openCourseware, records, refresh, remove, setArchived, threads]);
  const runtime = useExternalStoreRuntime({
    messages: EMPTY_MESSAGES, convertMessage: message => message, isRunning: busy,
    onNew: async () => {}, adapters: { threadList: adapter },
  });

  return <AssistantRuntimeProvider runtime={runtime}>
    <ThreadList archived={archived} portalContainer={portalContainer} disabled={disabled} error={error} onRetry={() => { void refresh(); }} searchRef={searchRef} rootRef={listRef}
      newDisabled={mutating} onNew={() => { if (!mutationLock.current) newCourseware(); }}
      // Intercept before the primitive changes its active thread, so cancelling
      // a draft guard leaves both the URL and list selection unchanged.
      onOpen={onOpenRequest ? openCourseware : undefined}
      onOpenCurrent={archived ? onOpen : undefined}
      onDelete={async id => {
        await runtime.threads.getItemById(id).delete();
        requestAnimationFrame(() => {
          const root = listRef.current;
          (root?.querySelector<HTMLButtonElement>('[data-active] [data-slot=aui_thread-list-item-trigger], [data-slot=aui_thread-list-new], [data-slot=aui_thread-list-item-trigger]') ?? root)?.focus();
        });
      }}
      onDeleteRequest={setDeleteIds}
      selection={{ enabled: selectionMode, ids: selectedIds,
        onToggleMode: () => { setSelectionMode(value => !value); setSelectedIds(new Set()); },
        onToggle: id => setSelectedIds(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
        onSelectAll: ids => setSelectedIds(new Set(ids)),
      }} />
    <Dialog open={deleteIds.length > 0} onOpenChange={open => { if (!open && !mutating) setDeleteIds([]); }}>
      <DialogContent portalContainer={portalContainer} className="max-w-sm" onCloseAutoFocus={event => {
        event.preventDefault();
        const root = listRef.current;
        (root?.querySelector<HTMLButtonElement>('[data-active] [data-slot=aui_thread-list-item-trigger], [data-slot=aui_thread-list-new], [data-slot=aui_thread-list-item-trigger]') ?? root)?.focus();
      }}>
        <DialogTitle>{deleteIds.length <= 1 ? '删除这个课件？' : `删除 ${deleteIds.length} 个课件？`}</DialogTitle>
        <DialogDescription>将永久删除课件、对话和画板历史，无法恢复。需要保留时可以选择归档。</DialogDescription>
        {error && <p role="alert" className="text-sm text-[var(--mm-text-amber-900)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button variant="ghost" disabled={mutating}>取消</Button></DialogClose>
          <Button variant="destructive" disabled={disabled} onClick={() => {
            const task = deleteIds.length === 1 ? runtime.threads.getItemById(deleteIds[0]).delete() : remove(deleteIds);
            void task.catch(() => {});
          }}>{mutating ? '正在删除…' : '确认删除'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </AssistantRuntimeProvider>;
}
