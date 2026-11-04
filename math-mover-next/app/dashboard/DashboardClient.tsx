'use client';

import { useState, useRef, useEffect, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import ControlDeck from '@/components/dashboard/ControlDeck';
import AgentChatPanel from '@/components/dashboard/AgentChatPanel';
import { useAgentRuntimeState } from '@/components/dashboard/AgentRuntimeState';
import ResizableChatRegion from '@/components/dashboard/ResizableChatRegion';
import CanvasStage from '@/components/dashboard/CanvasStage';
import { useGgbSession } from '@/hooks/useGgbSession';
import { useGgbGraphics } from '@/hooks/useGgbGraphics';
import { beginGgbRestore } from '@/lib/ggb-graphics-state';
import { attachGgbBridge } from '@/lib/ggb-bridge';
import type { GgbConnectionStatus } from '@/lib/ggb-connection';
import { agentFailure, agentResponseError } from '@/lib/agent-diagnostics';
import { finishExecution, updateToolProgress, toolStepLabel } from '@/lib/agent-progress';
import { metaFromToolCall, mergeRunMeta } from '@/lib/agent-run-meta';
import {
  AgentChatMessage,
  ChatAttachment,
  GeoGebraApi,
  CoursewareExportFormat,
} from '@/components/dashboard/types';
import { useCoursewareLibrary } from '@/hooks/useCoursewareLibrary';
import { syncConstructionDraft, type CoursewareRecord } from '@/lib/courseware-client';
import { historyBeforeUserMessage } from '@/lib/assistant-chat-adapter';
import { createStreamTextBatch } from '@/lib/stream-text-batch';
import { appendActivityText, classifyActivityText, recordActivityTool, settleActivity, type ActivityTextEvent } from '@/lib/agent-activity';
import { agentSendBlock } from '@/lib/agent-send-readiness';
import { prepareAgentImages } from '@/lib/agent-image-payload';
import { openSettings } from '@/lib/settings-navigation';
import { ComposerDrafts } from '@/lib/composer-drafts';

export default function Dashboard({ wsUrl }: { wsUrl: string }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-[var(--mm-canvas-shell)] text-[var(--mm-text-stone-500)] font-medium">
          正在加载工作台...
        </div>
      }
    >
      <DashboardContent wsUrl={wsUrl} />
    </Suspense>
  );
}

function DashboardContent({ wsUrl }: { wsUrl: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const requestedId = params.get('history_id') ?? undefined;
  const request = params.get('action') === 'new' ? 'new' : requestedId ?? 'blank';
  const [drafts] = useState(() => new ComposerDrafts());
  type Workspace = { key: string; initialId?: string; id?: string; error?: string | null };
  const [pool, setPool] = useState(() => {
    const key = crypto.randomUUID();
    const id = request === 'new' ? undefined : requestedId;
    return { request, activeKey: key, entries: [{ key, initialId: id, id }] as Workspace[] };
  });
  // Preserve the mounted editor (and its stream/bridge) when its URL first gains
  // an ID. Only the selected editor follows navigation; retained ones never do.
  if (pool.request !== request) {
    const current = pool.entries.find(entry => entry.key === pool.activeKey);
    const existing = request === 'new' ? undefined : request === 'blank'
      ? current && !current.id ? current : undefined
      : pool.entries.find(entry => entry.id === requestedId);
    const next = existing ?? { key: crypto.randomUUID(), initialId: request === 'new' ? undefined : requestedId, id: request === 'new' ? undefined : requestedId };
    setPool({ request, activeKey: next.key, entries: existing ? pool.entries : [...pool.entries, next] });
  }
  useEffect(() => {
    if (request === 'new') router.replace('/dashboard');
  }, [request, router]);
  const identify = useCallback((key: string, id: string) => setPool(previous => {
    if (previous.entries.find(entry => entry.key === key)?.id === id) return previous;
    return { ...previous, entries: previous.entries.map(entry => entry.key === key ? { ...entry, id } : entry) };
  }), []);
  const release = useCallback((key: string) => setPool(previous => previous.activeKey === key ? previous
    : { ...previous, entries: previous.entries.filter(entry => entry.key !== key) }), []);
  const reportSaveError = useCallback((key: string, error: string) => setPool(previous => ({ ...previous,
    entries: previous.entries.map(entry => entry.key === key ? { ...entry, error } : entry) })), []);
  const failed = pool.entries.find(entry => entry.key !== pool.activeKey && entry.error);
  return <>
    {pool.entries.map(entry => <div key={entry.key} data-slot="courseware-workspace" data-courseware-id={entry.id}
      data-active={entry.key === pool.activeKey ? 'true' : 'false'} aria-hidden={entry.key !== pool.activeKey} inert={entry.key !== pool.activeKey}
      className={`absolute inset-0 h-full w-full ${entry.key === pool.activeKey ? '' : 'invisible pointer-events-none'}`}>
      <DashboardWorkspace wsUrl={wsUrl} workspaceKey={entry.key} initialId={entry.initialId} active={entry.key === pool.activeKey}
        drafts={drafts} onIdentity={identify} onRelease={release} onSaveError={reportSaveError} />
    </div>)}
    {failed && <div role="alert" className="absolute inset-x-2 top-14 z-30 rounded-lg bg-[var(--mm-bg-amber-50)] p-3 text-sm text-[var(--mm-text-amber-900)]">
      后台课件保存失败：{failed.error}
      <button type="button" className="ml-2 underline" onClick={() => {
        setPool(previous => ({ ...previous, activeKey: failed.key }));
        router.push(failed.id ? `/dashboard?history_id=${encodeURIComponent(failed.id)}` : '/dashboard');
      }}>返回查看</button>
    </div>}
  </>;
}

function DashboardWorkspace({ wsUrl, workspaceKey, initialId, active, drafts, onIdentity, onRelease, onSaveError }: {
  wsUrl: string; workspaceKey: string; initialId?: string; active: boolean; drafts: ComposerDrafts;
  onIdentity: (key: string, id: string) => void; onRelease: (key: string) => void;
  onSaveError: (key: string, error: string) => void;
}) {
  const activeRef = useRef(active); activeRef.current = active;
  const [binding] = useState(() => ({ id: initialId }));
  const identify = useCallback((id: string) => onIdentity(workspaceKey, id), [onIdentity, workspaceKey]);

  // 当前课件状态
  const [currentTitle, setCurrentTitle] = useState('未命名课件');

  // 对话流状态
  // messages / isLoading 由 handleSendMessage 流式维护
  const [loadingStatusText, setLoadingStatusText] = useState('准备就绪');

  // 视图控制
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const canvasWorkspaceRef = useRef<HTMLDivElement>(null);

  // 桌面版首次启动（main 在 URL 上带 onboarding=1）自动打开设置——普通用户不知道
  // 还要先配端点/密钥；浏览器开发环境没有这个参数，不会被打扰。
  // 打开前把参数从地址栏摘掉：否则用户手动「重新加载」会再弹一次。
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('onboarding') !== '1') return;
    url.searchParams.delete('onboarding');
    window.history.replaceState(null, '', url.toString());
    const timer = setTimeout(openSettings, 800);
    return () => clearTimeout(timer);
  }, []);

  const handleToggleFullscreen = async () => {
    const workspace = canvasWorkspaceRef.current;
    if (!workspace) return;

    if (isFullscreen) {
      if (document.fullscreenElement === workspace) {
        await document.exitFullscreen();
      } else {
        setIsFullscreen(false);
      }
      return;
    }

    if (document.fullscreenEnabled && workspace.requestFullscreen) {
      try {
        await workspace.requestFullscreen();
        return;
      } catch (error) {
        console.warn('Browser fullscreen unavailable; using presentation view.', error);
      }
    }
    // 嵌入环境不支持浏览器全屏时，仍提供铺满视口的演示视图。
    setIsFullscreen(true);
  };

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === canvasWorkspaceRef.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  // GGB 引擎 Hook
  // 账本：已下发的构造指令清单。提到 useGgbSession 之前声明，
  // 好让 onAuditCompleted 的闭包能读到（回调运行时它一定已初始化）。
  const ledgerRef = useRef<string[]>([]);
  const {
    ggbApplet,
    lastExecutedCommands,
    restoreCommandLedger,
    handleAppletReady,
    executeCommands,
    setAxesVisible,
    setGridVisible,
    resetView,
    clearConstruction,
    exportGGB,
    exportPNG,
    exportHTML,
  } = useGgbSession({
    containerRef: canvasWorkspaceRef,
    // 画布体检结果此前只留在 hook 内部，用户看到的一直是「本轮没有对象检查数据」。
    // 这里写进最近一条助手消息的 meta，面板才有东西可显示。
    onAuditCompleted: (audit) => {
      setMessages(prev => {
        const i = prev.map(m => m.role).lastIndexOf('assistant');
        if (i < 0) return prev;
        const next = [...prev];
        next[i] = { ...prev[i], meta: { ...prev[i].meta,
          auditResult: audit, commands: [...ledgerRef.current] } };
        return next;
      });
    },
  });
  const graphics = useGgbGraphics(ggbApplet);
  const syncGraphics = graphics.sync;
  const showAxes = graphics.axes === 'all';
  const showGrid = graphics.showGrid;

  // ── Agent 对话 ──────────────────────────────────────────────
  // 驱动**本机已装的 agent CLI**（Claude Code / Codex / dsh），不需要 API key。
  // agent 通过 daemon 经 WebSocket 读写本工作区的画布；切到其他课件后，
  // 此实例仍挂载并接收工具调用，直到本轮结果完成保存。
  //
  // 传输用 NDJSON（自己的事件模型），不套 AI SDK 的 UI message stream：
  // AgentChatPanel 本来就是受控组件，直接消费更少代码，也免去与 ai 包的版本耦合。
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const { runtimes, activeRuntimeId, detecting, detectionError, setEditorBusy, recordFailure, clearFailure } = useAgentRuntimeState();
  const [isLoading, setIsLoading] = useState(false);
  const [settling, setSettling] = useState(false);
  const [finalSaveFailed, setFinalSaveFailed] = useState(false);
  const sessionIdRef = useRef<string | undefined>(undefined);
  // 当前这一轮的取消句柄。用户点「停止」→ abort fetch → 流被取消 →
  // route 的 ReadableStream.cancel() 杀掉 agent 子进程（见 app/api/agent/route.ts）。
  const abortRef = useRef<AbortController | null>(null);

  // ── Agent 运行时选择（PATH 扫描 + 用户自选，持久化） ──────────
  // 刻意**不自动降级**：用户选了哪个就用哪个，起不来就如实报错让他换。
  // 静默换 agent 会做出没预期的模型/风格，也掩盖真实的安装或鉴权问题。
  useEffect(() => {
    // 聊天顶部与设置共用选择；换 Agent 后不能续用旧运行时的 session。
    sessionIdRef.current = undefined;
  }, [activeRuntimeId]);

  // 模型选择按 agent 分别记（localStorage）。**不进课件记录**——模型是「怎么跑」的，
  // 不是「跑出了什么」；跟着课件走会让历史课件在换模型后语义混乱。
  // 状态升入 AgentRuntimeState：设置卡片与聊天区 composer 选择器写同一份。
  const { selectedModel, selectedEffort, selectModel: handleSelectModel, selectEffort: handleSelectEffort } = useAgentRuntimeState();

  useEffect(() => {
    ledgerRef.current = lastExecutedCommands;
  }, [lastExecutedCommands]);

  const executeCommandsRef = useRef(executeCommands);
  useEffect(() => {
    executeCommandsRef.current = executeCommands;
  }, [executeCommands]);

  const restoreCourseware = useCallback(async (record: CoursewareRecord | null) => {
    if (!ggbApplet) return;
    sessionIdRef.current = record && record.runtimeId === activeRuntimeId ? record.sessionId : undefined;
    setCurrentTitle(record?.title || '未命名课件');
    ledgerRef.current = record?.commands ?? [];
    setMessages(record?.messages ?? []);
    if (record?.ggbBase64) {
      if (!ggbApplet.setBase64) throw new Error('当前画板不支持完整快照恢复');
      const finishRestore = beginGgbRestore(ggbApplet);
      try { await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('画板恢复超时，未覆盖已保存的课件')), 15000);
        try { ggbApplet.setBase64!(record.ggbBase64!, () => { clearTimeout(timeout); resolve(); }); }
        catch (error) { clearTimeout(timeout); reject(error); }
      }); } finally { finishRestore(); }
    } else if (record?.commands.length) await executeCommands(record.commands);
    else clearConstruction();
    // A complete snapshot already owns its axis visibility, styles and range.
    // Coarse legacy flags must not overwrite a one-axis or custom-grid snapshot.
    if (!record?.ggbBase64 && record?.view) {
      setAxesVisible(record.view.showAxes); setGridVisible(record.view.showGrid);
      const b = record.view.bounds; if (b) ggbApplet.setCoordSystem?.(...b);
    } else if (!record?.ggbBase64) { setAxesVisible(true); setGridVisible(true); }
    syncGraphics();
    // Hook state may update its old command ledger during snapshot loading; the persisted one wins.
    ledgerRef.current = record?.commands ?? [];
    restoreCommandLedger(record?.commands ?? []);
  }, [ggbApplet, activeRuntimeId, restoreCommandLedger, executeCommands, clearConstruction, setAxesVisible, setGridVisible, syncGraphics]);
  const courseware = useCoursewareLibrary({ api: ggbApplet, messages, commands: ledgerRef, busy: isLoading,
    runtimeId: activeRuntimeId, sessionId: sessionIdRef, showAxes, showGrid, onRestore: restoreCourseware,
    active, binding, onIdentity: identify });
  const displayedTitle = courseware.summary?.title ?? currentTitle;
  const { windowId, markDirty, flush, canSend } = courseware;
  useEffect(() => {
    setEditorBusy(workspaceKey, isLoading || settling, courseware.summary?.id);
  }, [isLoading, settling, courseware.summary?.id, setEditorBusy, workspaceKey]);
  useEffect(() => () => setEditorBusy(workspaceKey, false), [setEditorBusy, workspaceKey]);
  useEffect(() => {
    if (isLoading || !settling) return;
    let cancelled = false;
    // The final message state has committed: capture the final board and answer
    // before dropping the running guard or disposing a background applet.
    void flush().then(() => {
      if (!cancelled) { setSettling(false); setFinalSaveFailed(false); }
    }, error => {
      if (cancelled) return;
      setFinalSaveFailed(true);
      if (!activeRef.current) onSaveError(workspaceKey, error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [isLoading, settling, flush, onSaveError, workspaceKey]);
  useEffect(() => {
    // A failed final save keeps the guard until the user retries successfully.
    if (settling && finalSaveFailed && courseware.status === 'saved') {
      setSettling(false); setFinalSaveFailed(false);
    }
  }, [settling, finalSaveFailed, courseware.status]);
  useEffect(() => {
    if (active || isLoading || settling) return;
    let cancelled = false;
    void flush().then(() => { if (!cancelled) onRelease(workspaceKey); }, error => {
      if (!cancelled) onSaveError(workspaceKey, error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [active, isLoading, settling, flush, onRelease, onSaveError, workspaceKey]);
  const [connectionStatus, setConnectionStatus] = useState<GgbConnectionStatus>('loading');
  const sendBlock = agentSendBlock({ connection: connectionStatus, detecting,
    detectionFailed: !!detectionError, active: runtimes.find(runtime => runtime.id === activeRuntimeId) });
  const bridgeCleanup = useRef<ReturnType<typeof attachGgbBridge> | null>(null);
  useEffect(() => () => bridgeCleanup.current?.(), []);
  const reconnectBridge = useCallback(() => bridgeCleanup.current?.reconnect(), []);
  useEffect(() => {
    if (active && ggbApplet) {
      window.ggbApplet = ggbApplet;
      bridgeCleanup.current?.activate();
    }
  }, [active, ggbApplet]);

  // 当前课件的 id —— 工作稿目录的键。走 ref 是因为重连自愈要用它，而把它塞进
  // 桥的依赖里会让每次保存都重挂一次 WebSocket。
  const coursewareIdRef = useRef<string | undefined>(undefined);
  useEffect(() => { coursewareIdRef.current = courseware.summary?.id; }, [courseware.summary?.id]);

  // applet 就绪：挂桥，让 agent 够得着这块画布
  const handleAppletReadyWithBridge = useCallback(
    (api: GeoGebraApi) => {
      handleAppletReady(api);
      bridgeCleanup.current?.();
      bridgeCleanup.current = attachGgbBridge(api, {
        windowId,
        active: () => activeRef.current,
        canvasRoot: canvasWorkspaceRef.current ?? undefined,
        onConnectionChange: (status) => {
          setConnectionStatus(status);
          // 草稿自愈：daemon 启动时会清掉孤儿工作区（见 daemon 的 workspaces.ts），
          // 而页面可能还开着、不会自动重灌。重连成功就按当前账本补一次——
          // 有了这条，草稿随删随补，回收逻辑才敢放手删。
          if (status === 'connected') {
            const id = coursewareIdRef.current;
            if (id) void syncConstructionDraft(ledgerRef.current, id);
          }
        },
        getLedger: () => ledgerRef.current,
        onLedgerChange: (commands) => {
          ledgerRef.current = commands;
          markDirty();
        },
        // 执行委托给 useGgbSession，避免两条执行路径导致状态不同步
        applyCommands: async ({ commands, incremental, ledger }) => {
          await executeCommandsRef.current(commands, { incremental: incremental === true });
          ledgerRef.current = ledger ?? commands;
          return { applied: commands, failedFirstPass: [] };
        },
        wsUrl,
      });
    },
    [handleAppletReady, windowId, markDirty, wsUrl],
  );

  // 切换坐标轴显示
  const handleToggleAxes = graphics.toggleAxes;

  // 切换网格显示
  const handleToggleGrid = graphics.toggleGrid;

  // 导出处理
  const handleExport = (type: CoursewareExportFormat) => {
    if (courseware.isRestoring || !ggbApplet) return;
    setExportError(null);
    const safeTitle = displayedTitle.replace(/[\\/:*?"<>|]/g, '_');
    if (type === 'html') {
      void exportHTML(`${safeTitle}.html`, displayedTitle).catch(error => {
        setExportError(error instanceof Error ? error.message : 'HTML 导出失败，请重试。');
      });
    } else if (type === 'ggb') {
      exportGGB(`${safeTitle}.ggb`);
    } else {
      if (!exportPNG(`${safeTitle}.png`)) setExportError('PNG 导出失败，请等待画板加载完成后重试。');
    }
  };

  // 全屏监听与快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen && !document.fullscreenElement) setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // 发送消息并触发 Agent 生成流程（支持多轮对话微调）
  /**
   * 发消息给本机 agent CLI，流式收它的回答。
   *
   * NDJSON keeps public narration/tool order in activity, and projects only
   * final or unclassified settled text into the answer. sessionId resumes CLI runs.
   */
  // 停止当前这一轮：abort fetch → 流取消 → route 杀掉 agent 子进程。
  // 本轮状态记为 stopped（不是 error），已产出的内容保留在气泡里。
  const stopRun = useCallback(() => {
    abortRef.current?.abort();
    setLoadingStatusText('正在停止…');
  }, []);

  const handleSendMessage = useCallback(
    async (text: string, attachments: ChatAttachment[], editMessageId?: string) => {
      if (isLoading || settling || abortRef.current || !canSend || sendBlock) return;
      const priorMessages = editMessageId ? historyBeforeUserMessage(messages, editMessageId) : messages;
      if (!priorMessages || (!text.trim() && !attachments.length)) return;
      // An edited turn must not resume the CLI session containing the superseded replies.
      if (editMessageId) sessionIdRef.current = undefined;
      clearFailure(activeRuntimeId);
      const controller = new AbortController();
      abortRef.current = controller;
      let stopped = false;

      const userMsg: AgentChatMessage = {
        id: `msg_user_${Date.now()}`,
        role: 'user',
        content: text,
        createdAt: Date.now(),
        attachments: attachments.length ? attachments : undefined,
      };
      const assistantId = `msg_agent_${Date.now()}`;

      const nextMessages: AgentChatMessage[] = [
        ...priorMessages,
        userMsg,
        { id: assistantId, role: 'assistant', content: '', createdAt: Date.now(),
          meta: { status: 'generating', activity: [], execution: { status: 'running', startedAt: Date.now(), steps: [] } } },
      ];
      setMessages(nextMessages);
      setIsLoading(true);
      setLoadingStatusText('等待 Agent 回复…');

      // 流式累积到助手气泡上
      const applyPatch = (fn: (m: AgentChatMessage) => AgentChatMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));
      let textContext: ActivityTextEvent = {};
      const textBatch = createStreamTextBatch(text => {
        const event = { ...textContext, text };
        applyPatch(m => appendActivityText(m, event));
      });
      const patch = (fn: (m: AgentChatMessage) => AgentChatMessage) => {
        // Tool/error/final state must never overtake buffered text.
        textBatch.flush();
        applyPatch(fn);
      };

      let sawDone = false;
      let sawError = false;
      let waitingForRetry = false;

      const reportFailure = (message: string, stage: 'request' | 'runtime', status?: number, code?: 'quota_exhausted') => {
        if (sawError) return;
        sawError = true;
        const diagnostic = agentFailure({ stage, message, status, code, runtimeId: activeRuntimeId });
        recordFailure(diagnostic);
        patch(m => ({ ...m, meta: { ...m.meta, retry: undefined, status: 'error', errorMessage: diagnostic.detail, diagnostic } }));
      };

      try {
        // Do not spend a model call until the user's question has reached local storage.
        // 顺带拿到课件 id：agent 的工作稿目录按它落（这次 flush 已经把记录建出来了）。
        // 拿不到就留空——落到 daemon 的 `_default`，**不要**退回窗口 id，那等于把
        // 「按窗口命名目录」放回来（正是这次要消除的东西）。
        const coursewareId = await flush(nextMessages);
        // Includes persisted asset URLs when editing/reopening an image question.
        // Never send a partial question after silently dropping an unreadable image.
        const imagePayloads = await prepareAgentImages(attachments, controller.signal);

        const res = await fetch('/api/agent', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            windowId,
            coursewareId,
            sessionId: sessionIdRef.current,
            restartFromHistory: editMessageId ? true : undefined,
            runtimeId: activeRuntimeId,
            // 不传「默认」——后端不传 --model，用 CLI 自己的配置
            model: selectedModel !== 'default' ? selectedModel : undefined,
            reasoningEffort: selectedEffort || undefined,
            images: imagePayloads.length ? imagePayloads : undefined,
            // 本轮之前保留的对话；编辑时用于重建新会话，dsh 用它延续语境。
            // 带图轮次在转写里只留占位（转写注入是纯文本通道）。
            // 纯图消息内容为空，但有附件——不能被 content 滤掉。
            history: priorMessages
              .filter((m) => (m.role === 'user' || m.role === 'assistant') && (m.content || m.attachments?.length))
              .map((m) => ({
                role: m.role,
                content: (m.content || '（只发了题目图片）') + (m.attachments?.length ? ` [附题目图 ${m.attachments.length} 张]` : ''),
              })),
          }),
        });

        if (!res.ok || !res.body) {
          const detail = !res.ok ? agentResponseError(await res.text()) : '服务没有返回消息流。';
          reportFailure(detail, 'request', res.status);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // 增量流与完整块会重复携带同一段文本：
        // 收到过 text-delta 后，紧随的 text 完整块只做收尾、不再追加。
        let streamedText = false;

        const handleLine = (raw: string) => {
          if (!raw.trim()) return;
          let ev: {
            kind?: string; text?: string; name?: string;
            sessionId?: string; message?: string; line?: string;
            toolCallId?: unknown; isError?: unknown; input?: unknown;
            messageId?: string; phase?: 'commentary' | 'final'; resultText?: string; status?: string;
            title?: string;
            retryAt?: number | null; attempt?: number; reason?: string; code?: string;
          };
          try { ev = JSON.parse(raw); } catch { return; }
          if (waitingForRetry && ['text', 'text-delta', 'tool-call', 'tool-result'].includes(ev.kind ?? '')) {
            waitingForRetry = false;
            patch(m => ({ ...m, meta: { ...m.meta, retry: undefined } }));
          }
          switch (ev.kind) {
            case 'retry': {
              if (sawError || sawDone) break;
              const retry = typeof ev.retryAt === 'number' && Number.isFinite(ev.retryAt) && ev.retryAt > 0 &&
                typeof ev.attempt === 'number' && Number.isInteger(ev.attempt) && ev.attempt > 0
                ? { retryAt: ev.retryAt, attempt: ev.attempt, reason: ev.reason === 'rate_limit' ? 'rate_limit' as const : 'unavailable' as const }
                : undefined;
              patch(m => ({ ...m, meta: { ...m.meta, retry } }));
              waitingForRetry = Boolean(retry);
              setLoadingStatusText(retry ? '等待模型服务重试…' : '等待 Agent 回复…');
              break;
            }
            case 'text-delta':
              if (textContext.messageId !== ev.messageId || textContext.phase !== ev.phase) textBatch.flush();
              textContext = { messageId: ev.messageId, phase: ev.phase };
              streamedText = true;
              textBatch.push(ev.text ?? '');
              break;
            case 'text':
              if (!streamedText || textContext.messageId !== ev.messageId) patch(m => appendActivityText(m, ev, true));
              else if (ev.phase) patch(m => classifyActivityText(m, ev.phase!, ev.messageId));
              streamedText = false;
              break;
            case 'text-phase':
              if (ev.phase) patch(m => classifyActivityText(m, ev.phase!, ev.messageId));
              break;
            case 'title':
              // 从正文里剥出来的课件名（`<mm-title>` 标记）。标记本身永远不出现在 text 里，
              // 宿主在 route 的出流口剥掉。命名优先级由 useCoursewareLibrary 管：
              // 用户手改的 > agent 起的（第一条带 meta.title 的消息赢）> 未命名课件。
              if (typeof ev.title === 'string') {
                patch(m => ({ ...m, meta: mergeRunMeta(m.meta, { title: ev.title }) }));
              }
              break;
            case 'session':
              sessionIdRef.current = ev.sessionId;
              break;
            case 'tool-call':
            case 'tool-result': {
              const now = Date.now();
              if (ev.kind === 'tool-call') {
                streamedText = false;
                setLoadingStatusText(`正在${toolStepLabel(ev.name ?? '')}…`);
                // 标题/类别是工具**入参**，AgentToolStep 不记入参，只能从事件流抓。
                const runMeta = metaFromToolCall(ev.name, ev.input);
                if (Object.keys(runMeta).length) {
                  patch(m => ({ ...m, meta: mergeRunMeta(m.meta, runMeta) }));
                }
              }
              else setLoadingStatusText('等待 Agent 回复…');
              patch(m => {
                if (!m.meta?.execution) return m;
                const execution = updateToolProgress(m.meta.execution, ev, now);
                const next = { ...m, meta: { ...m.meta, execution } };
                const step = typeof ev.toolCallId === 'string'
                  ? execution.steps.find(step => step.toolCallId === ev.toolCallId) : execution.steps.at(-1);
                return step ? recordActivityTool(next, step.id, ev.kind === 'tool-call') : next;
              });
              break;
            }
            case 'error':
              reportFailure(typeof ev.message === 'string' ? ev.message : '没有返回具体错误信息。', 'runtime', undefined,
                ev.code === 'quota_exhausted' ? ev.code : undefined);
              break;
            case 'done':
              sawDone = true;
              if (ev.status === 'cancelled' && !sawError) stopped = true;
              patch(m => settleActivity(m, ev.status !== 'cancelled' && !sawError ? ev.resultText : undefined));
              if (ev.sessionId) sessionIdRef.current = ev.sessionId;
              break;
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const raw of lines) handleLine(raw);
        }
        handleLine(buffer + decoder.decode());
        if (!sawDone && !sawError && !stopped) reportFailure('消息流结束，但没有收到任务完成标记。无法确认此次任务是否完成。', 'runtime');
      } catch (e) {
        // 用户点「停止」是正常打断，不是失败——不要报成错误
        if (controller.signal.aborted && !sawError) stopped = true;
        else reportFailure(String(e instanceof Error ? e.message : e), 'request');
      } finally {
        const now = Date.now();
        if (abortRef.current === controller) abortRef.current = null;
        const status = stopped ? 'stopped' : sawError ? 'error' : sawDone ? 'completed' : 'unconfirmed';
        patch(m => {
          const next = settleActivity(m);
          return next.meta?.execution ? { ...next, meta: { ...next.meta,
            retry: undefined,
            status: stopped ? 'stopped' : sawError ? 'error' : 'completed',
            execution: finishExecution(next.meta.execution, status, now) } } : next;
        });
        setSettling(true);
        setIsLoading(false);
        setLoadingStatusText('准备就绪');
      }
    },
    [isLoading, settling, activeRuntimeId, selectedModel, selectedEffort, recordFailure, clearFailure, messages, canSend, sendBlock, flush, windowId],
  );

  const handleEditMessage = useCallback(async (messageId: string, text: string, attachments: ChatAttachment[]) => {
    await handleSendMessage(text, attachments, messageId);
  }, [handleSendMessage]);

  return (
    <div data-slot="dashboard-root" className="flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-[var(--mm-canvas-shell)] [[data-desktop]_&]:h-[calc(100dvh-var(--desktop-titlebar-height,40px))]">
      {/* 工具栏与画布共用一个工作区；全屏时保留同一个 Applet 实例。 */}
      <div
        ref={canvasWorkspaceRef}
        className={`flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--mm-canvas-shell)] ${isFullscreen ? 'fixed inset-0 z-40 h-dvh w-screen' : 'relative h-full'}`}
      >
        <ControlDeck
          title={displayedTitle}
          connectionStatus={connectionStatus}
          onReconnect={reconnectBridge}
          editorId={courseware.editorId}
          onRename={courseware.renameTitle}
          renameDisabled={isLoading || settling || !courseware.canSend || !ggbApplet}
          boardDisabled={courseware.isRestoring || !ggbApplet}
          saveStatusText={courseware.isOpening ? undefined : courseware.saveStatusText}
          showAxes={showAxes}
          axesMixed={graphics.axes === 'mixed'}
          showGrid={showGrid}
          settingsOpen={graphics.settingsOpen}
          onToggleSettings={ggbApplet ? graphics.toggleSettings : undefined}
          isFullscreen={isFullscreen}
          onToggleAxes={handleToggleAxes}
          onToggleGrid={handleToggleGrid}
          onResetView={resetView}
          onToggleFullscreen={handleToggleFullscreen}
          onExport={handleExport}
        />
        {courseware.error && <div role="alert" className="flex shrink-0 items-center justify-between gap-3 bg-[var(--mm-bg-amber-50)] px-4 py-2 text-sm text-[var(--mm-text-amber-900)]">
          <span>{courseware.error}</span><button type="button" className="shrink-0 rounded px-2 py-1 underline focus-visible:outline-2 focus-visible:outline-[var(--mm-border-amber-800)]" onClick={courseware.retry}>{courseware.retryLabel}</button>
        </div>}
        {exportError && (
          <div role="alert" className="flex shrink-0 items-center justify-between gap-3 bg-[var(--mm-bg-red-50)] px-4 py-2 text-sm text-[var(--mm-text-red-800)]">
            <span>{exportError}</span>
            <button type="button" aria-label="关闭导出提示" onClick={() => setExportError(null)} className="rounded p-1 hover:bg-[var(--mm-bg-red-100)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div data-slot="board-surface" className={`relative flex min-h-0 min-w-0 flex-1 overflow-hidden ${isFullscreen ? '' : 'mx-2 mb-2 rounded-lg border border-[var(--mm-border-stone-300)]'}`}>
          <CanvasStage onAppletReady={handleAppletReadyWithBridge} blocked={courseware.isRestoring} opening={courseware.isOpening} active={active} />
        </div>
      </div>

      {/* 右侧 Agent 智能体对话面板 */}
      <ResizableChatRegion disabled={isFullscreen}>
        <AgentChatPanel
          composerDrafts={drafts}
          messages={messages}
          conversationId={courseware.summary?.id}
          editorId={courseware.editorId}
          isLoading={isLoading}
          sendDisabled={settling || !courseware.canSend || !!sendBlock}
          sendBlock={sendBlock}
          onReconnectBoard={reconnectBridge}
          onOpenSettings={openSettings}
          loadingStatusText={loadingStatusText}
          onSendMessage={handleSendMessage}
          onEditMessage={handleEditMessage}
          onStopRun={stopRun}
          runtimes={runtimes}
          activeRuntimeId={activeRuntimeId}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
          selectedEffort={selectedEffort}
          onSelectEffort={handleSelectEffort}
        />
      </ResizableChatRegion>

    </div>
  );
}
