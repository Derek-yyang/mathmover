'use client';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AgentChatMessage, GeoGebraApi } from '@/components/dashboard/types';
import { ggbClientEventType, readGgbGraphics, watchGgbGraphics } from '@/lib/ggb-graphics-state';
import { captureGgb, currentView, getCourseware, historyChanged, interruptedMessages, libraryRequest, persistableMessages, renameCourseware, syncConstructionDraft,
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
  const [slowSaving, setSlowSaving] = useState(false);
  const saveNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [windowId] = useState(() => crypto.randomUUID());
  // Stable through a first autosave, but distinct for each explicit new editor.
  const [editorId, setEditorId] = useState(() => params.get('history_id') || `new:${crypto.randomUUID()}`);
  const state = useRef(options); state.current = options;
  const record = useRef<CoursewareRecord | null>(null);
  const dirty = useRef(0); const saved = useRef(0); const restoring = useRef(true);
  const conflict = useRef(false);
  const restoredInputs = useRef<{ messages: AgentChatMessage[]; showAxes: boolean; showGrid: boolean; runtimeId?: string } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve()); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadQueue = useRef<Promise<void>>(Promise.resolve());
  // flush 顺带把课件 id 交出来——发送消息那条路要拿它当 agent 的工作稿目录键
  // （目录按课件落，见 packages/daemon/src/workspaces.ts）。
  const flushRef = useRef<(messages?: AgentChatMessage[]) => Promise<string | undefined>>(async () => undefined);
  const markDirty = useCallback(() => {
    if (restoring.current) return;
    dirty.current++;
    if (conflict.current) return;
    setStatus('dirty');
    // Fixed first-change timer rather than perpetual debounce: streams save at bounded intervals.
    if (!timer.current) timer.current = setTimeout(() => { timer.current = null; void flushRef.current().catch(() => {}); }, 1000);
  }, []);
  const flush = useCallback((messageOverride?: AgentChatMessage[], titleOverride?: string) => {
    const perform = async () => {
      const o = state.current;
      if (!o.api || restoring.current) return;
      if (conflict.current) throw new Error('本窗口存在版本冲突，请先导出画板或复制未保存的聊天，再重新加载本地版本');
      if (!record.current && titleOverride === undefined && !(messageOverride?.length || o.messages.length || o.api.getAllObjectNames().length)) return;
      if (!messageOverride && titleOverride === undefined && dirty.current === saved.current && record.current) return;
      setStatus('saving'); setError(null);
      // Exclude the autosave debounce and queue wait. New edits may mark an active save dirty.
      setSlowSaving(false);
      saveNoticeTimer.current = setTimeout(() => { setSlowSaving(true); }, 1000);
      try {
        // 自动名：首条用户消息截 40 字。agent 起的名（meta.title）只在用户没手改过时才盖上。
        // 纯图发题（没打字）：叫「题目图片」，别让空内容掉进「未命名课件」。
        const firstUser = (messageOverride ?? o.messages).find(m => m.role === 'user');
        const autoTitle = firstUser?.content.trim().slice(0, 40)
          || (firstUser?.attachments?.length ? '题目图片' : '未命名课件');
        if (!record.current) {
          const now = new Date().toISOString();
          record.current = { id: crypto.randomUUID(), revision: 0, title: autoTitle, commands: [], messages: [], created_at: now, updated_at: now, archived_at: null };
          setSummary(record.current);
        }
        const current = record.current;
        const generation = dirty.current;
        const messages = await persistableMessages(messageOverride ?? o.messages);
        // During Agent execution preserve the last confirmed canvas checkpoint. Final/idle writes capture live state.
        const reuseCheckpoint = o.busy && !!current.ggbBase64;
        const ggbBase64 = reuseCheckpoint ? current.ggbBase64 : await captureGgb(o.api);
        // 课件名优先级：用户手改的 > agent 起的（正文 `<mm-title>` 标记剥出来的）> 首条消息截断。
        //
        // 「手改过」用「当前名 ≠ 自动名」推断。看着粗，但够用：
        // 用户起的名只要与自动名不同就会被保住——这正是需要保护的场景。
        // 而「用户改成了恰好等于自动名」的边角可以忽略：那要么他没真改、只是接受了
        // 默认占位，要么意图与「无偏好」不可区分；两种情况下让 agent 覆盖都不违背
        // 用户意图，反而会让标题从占位升级成更好的总结。所以不需要 titleLocked 标记。
        //
        // 偏紧一侧的副作用正好是想要的：标题命名的是「用户第一条消息要做什么」，
        // 多轮微调后**不该**跟着变。
        const agentTitle = (messageOverride ?? o.messages).find(m => m.meta?.title)?.meta?.title;
        const title = titleOverride ?? (current.title && current.title !== autoTitle ? current.title : (agentTitle || autoTitle));
        const next = { ...current, title, commands: reuseCheckpoint ? current.commands : [...o.commands.current], messages, ggbBase64,
          view: reuseCheckpoint ? current.view : currentView(o.api, o.showAxes, o.showGrid), runtimeId: o.runtimeId, sessionId: o.sessionId.current };
        const result = await libraryRequest<CoursewareSummary>('', { ...next, expectedRevision: current.revision });
        record.current = { ...next, ...result }; saved.current = generation;
        setSummary(result); setStatus(dirty.current === generation ? 'saved' : 'dirty'); historyChanged();
        const here = new URL(window.location.href);
        if (!here.searchParams.has('history_id') && !here.searchParams.has('action')) router.replace(`/dashboard?history_id=${encodeURIComponent(result.id)}`);
        return current.id;
      } finally {
        if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
        saveNoticeTimer.current = null;
        setSlowSaving(false);
      }
    };
    const job = queue.current.catch(() => {}).then(perform).catch(e => {
      if (e instanceof CoursewareError && e.status === 409) conflict.current = true;
      setError((e instanceof Error ? e.message : String(e)) + (conflict.current ? '。请先导出画板或复制未保存的聊天，再重新加载本地版本。' : '')); setStatus('error'); throw e;
    });
    queue.current = job;
    return job;
  }, [router]);
  flushRef.current = flush;
  const renameTitle = useCallback((title: string) => {
    const next = title.trim();
    if (!next || next.length > 200) return Promise.reject(new Error('课件名称需要为 1–200 个字符'));
    if (state.current.busy || restoring.current || conflict.current) return Promise.reject(new Error('请等待当前操作完成后重命名'));
    // A named blank courseware is meaningful: persist its first snapshot even with no messages or objects.
    // flush 现在会把课件 id 交出来（供发送那条路当工作稿目录键）；重命名不需要它，抹平掉。
    if (!record.current || record.current.revision === 0) return flush(undefined, next).then(() => undefined);
    const id = record.current.id;
    // Share the autosave queue so a pending snapshot cannot overwrite the new name or revision.
    const job = queue.current.catch(() => {}).then(async () => {
      const current = record.current;
      if (!current || current.id !== id || state.current.busy || restoring.current || conflict.current) throw new Error('课件状态已变化，请重新打开后重命名');
      if (current.title !== next) await renameCourseware(current.id, next, current.revision);
    });
    queue.current = job;
    return job;
  }, [flush]);
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
      const type = ggbClientEventType(event);
      if (type && ['viewChanged2D', 'viewChanged3D', 'storeUndo', 'clear', 'rename', 'updateStyle', 'dragEnd', 'animationStop'].includes(type)) markDirty();
    }; api.registerClientListener?.(client);
    let signature: string | undefined;
    const stopGraphics = watchGgbGraphics(api, graphics => {
      if (signature !== undefined && signature !== graphics.signature) markDirty();
      signature = graphics.signature;
    });
    return () => { stopGraphics(); api.unregisterUpdateListener(changed); api.unregisterAddListener?.(changed); api.unregisterRemoveListener?.(changed); api.unregisterClientListener?.(client); };
  }, [options.api, markDirty]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const current = record.current;
      if (['rename', 'archive', 'unarchive'].includes(detail?.kind) && current && current.id === detail.summary.id) {
        if (detail.summary.revision !== current.revision + 1 && detail.summary.revision !== current.revision) { conflict.current = true; setStatus('error'); setError('课件版本发生冲突，请先导出画板或复制未保存的聊天，再重新加载本地版本'); return; }
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
    if (requestedId === record.current?.id && action !== 'new' && !restoring.current) return;
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
        const loaded = requestedId && action !== 'new' ? await getCourseware(requestedId) : null;
        if (cancelled) return;
        if (loaded) loaded.messages = interruptedMessages(loaded.messages ?? []);
        restoredInputs.current = { messages: loaded?.messages ?? [], showAxes: loaded?.view?.showAxes ?? true, showGrid: loaded?.view?.showGrid ?? true, runtimeId: state.current.runtimeId };
        await state.current.onRestore(loaded);
        if (cancelled) return;
        // 同步进工作稿（按**课件**落目录）：不同步的话画布已是新图、agent 读到的草稿
        // 还是上一张的，它接着改就改错对象。失败不拦恢复流程（草稿是 agent 的便利品）。
        // 新建空会话没有课件（loaded 为空）——按课件分目录后不存在串台，无需清空谁的草稿。
        if (loaded) void syncConstructionDraft(loaded.commands ?? [], loaded.id);
        const graphics = state.current.api && readGgbGraphics(state.current.api);
        if (graphics && restoredInputs.current) {
          restoredInputs.current.showAxes = graphics.axes === 'all';
          restoredInputs.current.showGrid = graphics.showGrid;
        }
        record.current = loaded; setSummary(loaded); dirty.current = 0; saved.current = 0; conflict.current = false;
        if (loaded) setEditorId(loaded.id);
        else if (action === 'new' || requestedId) setEditorId(`new:${crypto.randomUUID()}`);
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
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('visibilitychange', hidden); if (timer.current) clearTimeout(timer.current); if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current); };
  }, [flush]);
  // Block interaction from the requested URL change, including the outgoing save
  // and queued restores. An unsuccessful restore stays protected until retry.
  const navigationPending = action === 'new' || (!!requestedId && requestedId !== record.current?.id);
  const isRestoring = !!options.api && (restoring.current || navigationPending);
  return { summary, status, error, windowId, editorId, markDirty, flush, renameTitle,
    isRestoring, isOpening: isRestoring && !error,
    saveStatusText: status === 'error' ? '保存／恢复失败' : status === 'restoring' ? '恢复中…' : slowSaving ? '保存中…' : '',
    canSend: !restoring.current && !navigationPending && !conflict.current && status !== 'restoring',
    retryLabel: conflict.current ? '重新加载本地版本' : '重试',
    retry: () => { if (restoring.current || conflict.current) window.location.reload(); else void flush().catch(() => {}); } };
}
