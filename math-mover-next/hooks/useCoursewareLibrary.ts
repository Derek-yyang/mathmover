'use client';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AgentChatMessage, GeoGebraApi } from '@/components/dashboard/types';
import { captureGgb, currentView, getCourseware, historyChanged, interruptedMessages, libraryRequest, migrateLegacyHistory, persistableMessages,
  CoursewareError, type CoursewareRecord, type CoursewareSummary } from '@/lib/courseware-client';

interface Options {
  api: GeoGebraApi | null; messages: AgentChatMessage[]; commands: MutableRefObject<string[]>;
  busy: boolean; runtimeId?: string; sessionId: MutableRefObject<string | undefined>;
  showAxes: boolean; showGrid: boolean;
  onRestore: (record: CoursewareRecord | null) => Promise<void>;
}
export function useCoursewareLibrary(options: Options) {
  const router = useRouter(); const params = useSearchParams();
  const [summary, setSummary] = useState<CoursewareSummary | null>(null);
  const [status, setStatus] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'restoring'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [windowId] = useState(() => crypto.randomUUID());
  const state = useRef(options); state.current = options;
  const record = useRef<CoursewareRecord | null>(null);
  const dirty = useRef(0); const saved = useRef(0); const restoring = useRef(true);
  const conflict = useRef(false);
  const restoredInputs = useRef<{ messages: AgentChatMessage[]; showAxes: boolean; showGrid: boolean; runtimeId?: string } | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve()); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadQueue = useRef<Promise<void>>(Promise.resolve());
  const flushRef = useRef<(messages?: AgentChatMessage[]) => Promise<void>>(async () => {});
  const markDirty = useCallback(() => {
    if (restoring.current) return;
    dirty.current++;
    if (conflict.current) return;
    setStatus('dirty');
    // Fixed first-change timer rather than perpetual debounce: streams save at bounded intervals.
    if (!timer.current) timer.current = setTimeout(() => { timer.current = null; void flushRef.current().catch(() => {}); }, 1000);
  }, []);
  const flush = useCallback((messageOverride?: AgentChatMessage[]) => {
    const perform = async () => {
      const o = state.current;
      if (!o.api || restoring.current) return;
      if (conflict.current) throw new Error('本窗口存在版本冲突，请先导出画板或复制未保存的聊天，再重新加载本地版本');
      if (!record.current && !(messageOverride?.length || o.messages.length || o.api.getAllObjectNames().length)) return;
      if (!messageOverride && dirty.current === saved.current && record.current) return;
      setStatus('saving'); setError(null);
      if (!record.current) {
        const title = (messageOverride ?? o.messages).find(m => m.role === 'user')?.content.trim().slice(0, 40) || '未命名课件';
        const now = new Date().toISOString();
        record.current = { id: crypto.randomUUID(), revision: 0, title, category: null, commands: [], messages: [], created_at: now, updated_at: now, deleted_at: null };
        setSummary(record.current);
      }
      const current = record.current;
      const generation = dirty.current;
      const messages = await persistableMessages(messageOverride ?? o.messages);
      // During Agent execution preserve the last confirmed canvas checkpoint. Final/idle writes capture live state.
      const reuseCheckpoint = o.busy && !!current.ggbBase64;
      const ggbBase64 = reuseCheckpoint ? current.ggbBase64 : await captureGgb(o.api);
      const next = { ...current, commands: reuseCheckpoint ? current.commands : [...o.commands.current], messages, ggbBase64,
        view: reuseCheckpoint ? current.view : currentView(o.api, o.showAxes, o.showGrid), runtimeId: o.runtimeId, sessionId: o.sessionId.current };
      const result = await libraryRequest<CoursewareSummary>('', { ...next, expectedRevision: current.revision });
      record.current = { ...next, ...result }; saved.current = generation;
      setSummary(result); setStatus(dirty.current === generation ? 'saved' : 'dirty'); historyChanged();
      const here = new URL(window.location.href);
      if (!here.searchParams.has('history_id') && !here.searchParams.has('action')) router.replace(`/dashboard?history_id=${encodeURIComponent(result.id)}`);
    };
    const job = queue.current.catch(() => {}).then(perform).catch(e => {
      if (e instanceof CoursewareError && e.status === 409) conflict.current = true;
      setError((e instanceof Error ? e.message : String(e)) + (conflict.current ? '。请先导出画板或复制未保存的聊天，再重新加载本地版本。' : '')); setStatus('error'); throw e;
    });
    queue.current = job;
    return job;
  }, [router]);
  flushRef.current = flush;
  useEffect(() => {
    if (restoring.current) return;
    // Restoring React's message/view state is not a user edit. Do not create a new
    // revision merely by opening a courseware in another window.
    const baseline = restoredInputs.current;
    if (baseline && !options.busy && (baseline.messages === options.messages || (!baseline.messages.length && !options.messages.length))
      && baseline.showAxes === options.showAxes && baseline.showGrid === options.showGrid && baseline.runtimeId === options.runtimeId) return;
    restoredInputs.current = null;
    markDirty();
  }, [options.messages, options.showAxes, options.showGrid, options.runtimeId, options.busy, markDirty]);
  useEffect(() => {
    const api = options.api; if (!api) return;
    const changed = () => markDirty();
    api.registerUpdateListener(changed);
    api.registerAddListener?.(changed); api.registerRemoveListener?.(changed);
    const client = (event: unknown) => {
      const type = (event as { type?: string } | null)?.type;
      if (type && ['viewChanged2D', 'viewChanged3D', 'storeUndo', 'clear', 'rename', 'updateStyle', 'dragEnd', 'animationStop'].includes(type)) markDirty();
    }; api.registerClientListener?.(client);
    return () => { api.unregisterUpdateListener(changed); api.unregisterAddListener?.(changed); api.unregisterRemoveListener?.(changed); api.unregisterClientListener?.(client); };
  }, [options.api, markDirty]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const current = record.current;
      if (detail?.kind === 'rename' && current && current.id === detail.summary.id) {
        if (detail.summary.revision !== current.revision + 1) { conflict.current = true; setStatus('error'); setError('课件版本发生冲突，请先导出画板或复制未保存的聊天，再重新加载本地版本'); return; }
        record.current = { ...current, ...detail.summary }; setSummary(detail.summary);
      }
      if (detail?.kind === 'delete' && record.current && detail.ids.includes(record.current.id)) {
        record.current = null; saved.current = dirty.current; restoring.current = true; setSummary(null); setStatus('restoring');
      }
    };
    window.addEventListener('mathmover_coursewares_changed', changed);
    return () => window.removeEventListener('mathmover_coursewares_changed', changed);
  }, []);
  useEffect(() => {
    state.current.sessionId.current = record.current?.runtimeId === options.runtimeId ? record.current?.sessionId : undefined;
  }, [options.runtimeId]);
  const requestedId = params.get('history_id'); const action = params.get('action');
  useEffect(() => {
    if (!options.api) return;
    if (requestedId === record.current?.id && action !== 'new') return;
    let cancelled = false;
    const load = async () => {
      if (state.current.busy) {
        if (record.current) router.replace(`/dashboard?history_id=${record.current.id}`);
        setError('任务进行中，请等待完成后切换课件'); return;
      }
      try {
        if (!restoring.current) await flush();
        if (cancelled) return;
        restoring.current = true; setStatus('restoring'); setError(null);
        await migrateLegacyHistory();
        const loaded = requestedId && action !== 'new' ? await getCourseware(requestedId) : null;
        if (cancelled) return;
        if (loaded?.deleted_at) throw new Error('该课件在回收站中，请先恢复');
        if (loaded) loaded.messages = interruptedMessages(loaded.messages ?? []);
        restoredInputs.current = { messages: loaded?.messages ?? [], showAxes: loaded?.view?.showAxes ?? true, showGrid: loaded?.view?.showGrid ?? true, runtimeId: state.current.runtimeId };
        await state.current.onRestore(loaded);
        if (cancelled) return;
        record.current = loaded; setSummary(loaded); dirty.current = 0; saved.current = 0; conflict.current = false;
        restoring.current = false; setStatus(loaded ? 'saved' : 'idle');
        if (action === 'new') router.replace('/dashboard');
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setStatus('error');
          // Failed outgoing save must keep the outgoing editor and URL, never load a different record.
          if (record.current && !restoring.current) router.replace(`/dashboard?history_id=${record.current.id}`);
        }
      }
    };
    // setBase64 is asynchronous and cannot be cancelled. Serialize restores so an old
    // callback never finishes after (and overwrites) the newer requested courseware.
    loadQueue.current = loadQueue.current.catch(() => {}).then(() => { if (!cancelled) return load(); });
    return () => { cancelled = true; };
  }, [requestedId, action, options.api, flush, router]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (state.current.busy || (dirty.current !== saved.current && (record.current || state.current.messages.length || state.current.api?.getAllObjectNames().length))) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    const hidden = () => { if (document.visibilityState === 'hidden' && !restoring.current) void flush().catch(() => {}); };
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('visibilitychange', hidden); if (timer.current) clearTimeout(timer.current); };
  }, [flush]);
  return { summary, status, error, windowId, markDirty, flush, canSend: !restoring.current && !conflict.current && status !== 'restoring',
    retryLabel: conflict.current ? '重新加载本地版本' : '重试',
    retry: () => { if (restoring.current || conflict.current) window.location.reload(); else void flush().catch(() => {}); } };
}
