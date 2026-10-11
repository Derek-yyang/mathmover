'use client';

import { useState, useRef, useEffect, Suspense, useCallback } from 'react';
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
import type { CoursewareRecord } from '@/lib/courseware-client';

export default function Dashboard() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-[#FDFCF8] text-stone-500 font-medium">
          正在加载工作台...
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {

  // 当前课件状态
  const [currentTitle, setCurrentTitle] = useState('未命名课件');

  // 对话流状态
  // messages / isLoading 由 handleSendMessage 流式维护
  const [loadingStatusText, setLoadingStatusText] = useState('准备就绪');

  // 视图控制
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const canvasWorkspaceRef = useRef<HTMLDivElement>(null);

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
    sliders,
    lastExecutedCommands,
    restoreCommandLedger,
    refreshSliders,
    handleAppletReady,
    executeCommands,
    setSliderValue,
    toggleSliderAnimation,
    setAxesVisible,
    setGridVisible,
    resetView,
    clearConstruction,
    exportGGB,
    exportPNG,
    exportHTML,
  } = useGgbSession({
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
  // agent 通过 daemon 经 WebSocket 读写**用户正在看的**这块画布：
  // 它看到的和用户看到的是同一个实例。
  //
  // 传输用 NDJSON（自己的事件模型），不套 AI SDK 的 UI message stream：
  // AgentChatPanel 本来就是受控组件，直接消费更少代码，也免去与 ai 包的版本耦合。
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const { runtimes, activeRuntimeId, selectRuntime: handleSelectRuntime, busy: isLoading, setBusy: setIsLoading, recordFailure, clearFailure } = useAgentRuntimeState();
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
  const [modelByAgent, setModelByAgent] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('mathmover_model_by_agent') ?? '{}') as Record<string, string>; }
    catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem('mathmover_model_by_agent', JSON.stringify(modelByAgent)); } catch { /* 隐私模式等，丢选择不影响使用 */ }
  }, [modelByAgent]);
  const selectedModel = (activeRuntimeId && modelByAgent[activeRuntimeId]) || 'default';
  const handleSelectModel = useCallback((id: string) => {
    if (!activeRuntimeId) return;
    setModelByAgent(prev => ({ ...prev, [activeRuntimeId]: id }));
  }, [activeRuntimeId]);

  // 推理档位按「agent + 模型」记：换个模型档位集就变了，不能跟着 agent 走。
  // 用 JSON 一层套娃当 key，避免 agent/model 里的斜杠歧义。
  const effortKey = JSON.stringify([activeRuntimeId ?? '', selectedModel]);
  const [effortByModel, setEffortByModel] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('mathmover_effort_by_model') ?? '{}') as Record<string, string>; }
    catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem('mathmover_effort_by_model', JSON.stringify(effortByModel)); } catch { /* 隐私模式等 */ }
  }, [effortByModel]);
  const selectedEffort = effortByModel[effortKey];
  const handleSelectEffort = useCallback((id: string) => {
    setEffortByModel(prev => ({ ...prev, [JSON.stringify([activeRuntimeId ?? '', selectedModel])]: id }));
  }, [activeRuntimeId, selectedModel]);


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
      refreshSliders(ggbApplet);
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
  }, [ggbApplet, activeRuntimeId, refreshSliders, restoreCommandLedger, executeCommands, clearConstruction, setAxesVisible, setGridVisible, syncGraphics]);
  const courseware = useCoursewareLibrary({ api: ggbApplet, messages, commands: ledgerRef, busy: isLoading,
    runtimeId: activeRuntimeId, sessionId: sessionIdRef, showAxes, showGrid, onRestore: restoreCourseware });
  const displayedTitle = courseware.summary?.title ?? currentTitle;
  const { windowId, markDirty, flush, canSend } = courseware;
  const bridgeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => bridgeCleanup.current?.(), []);

  // applet 就绪：挂桥，让 agent 够得着这块画布
  const handleAppletReadyWithBridge = useCallback(
    (api: GeoGebraApi) => {
      handleAppletReady(api);
      bridgeCleanup.current?.();
      bridgeCleanup.current = attachGgbBridge(api, {
        windowId,
        getLedger: () => ledgerRef.current,
        onLedgerChange: (commands) => {
          ledgerRef.current = commands;
          markDirty();
        },
        // 执行委托给 useGgbSession，避免两条执行路径导致状态不同步
        applyCommands: async (commands) => {
          await executeCommandsRef.current(commands);
          ledgerRef.current = commands;
          return { applied: commands, failedFirstPass: [] };
        },
        wsUrl: process.env.NEXT_PUBLIC_MATHMOVER_WS_URL || 'ws://127.0.0.1:8787',
      });
    },
    [handleAppletReady, windowId, markDirty],
  );

  // 切换坐标轴显示
  const handleToggleAxes = graphics.toggleAxes;

  // 切换网格显示
  const handleToggleGrid = graphics.toggleGrid;

  // 导出处理
  const handleExport = (type: CoursewareExportFormat) => {
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
   * 事件是 NDJSON：text-delta 累积成正文，tool-call/tool-result 用于显示
   * "它在干什么"，done 收尾。多轮靠 sessionId 续（--resume）。
   */
  // 停止当前这一轮：abort fetch → 流取消 → route 杀掉 agent 子进程。
  // 本轮状态记为 stopped（不是 error），已产出的内容保留在气泡里。
  const stopRun = useCallback(() => {
    abortRef.current?.abort();
    setLoadingStatusText('正在停止…');
  }, []);

  const handleSendMessage = useCallback(
    async (text: string, attachments: ChatAttachment[]) => {
      if (isLoading || !canSend) return;
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
        ...messages,
        userMsg,
        { id: assistantId, role: 'assistant', content: '', createdAt: Date.now(),
          meta: { status: 'generating', execution: { status: 'running', startedAt: Date.now(), steps: [] } } },
      ];
      setMessages(nextMessages);
      setIsLoading(true);
      setLoadingStatusText('等待 Agent 回复…');

      // 流式累积到助手气泡上
      const patch = (fn: (m: AgentChatMessage) => AgentChatMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      let sawDone = false;
      let sawError = false;

      const reportFailure = (message: string, stage: 'request' | 'runtime', status?: number) => {
        sawError = true;
        const diagnostic = agentFailure({ stage, message, status, runtimeId: activeRuntimeId });
        recordFailure(diagnostic);
        patch(m => ({ ...m, meta: { ...m.meta, status: 'error', errorMessage: diagnostic.detail, diagnostic } }));
      };

      try {
        // Do not spend a model call until the user's question has reached local storage.
        await flush(nextMessages);
        // 题目图片：File → base64（blob: URL 路由读不了，必须在这里转）
        const imagePayloads: { mediaType: string; base64: string; name?: string }[] = [];
        for (const a of attachments ?? []) {
          try {
            let dataUrl = a.url;
            if (a.file) {
              dataUrl = await new Promise<string>((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(String(r.result));
                r.onerror = () => rej(r.error);
                r.readAsDataURL(a.file as File);
              });
            }
            const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl);
            if (m && m[1].startsWith('image/')) {
              imagePayloads.push({ mediaType: m[1], base64: m[2], name: a.name });
            }
          } catch { /* 单张转码失败不拦发送 */ }
        }

        const res = await fetch('/api/agent', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            windowId,
            sessionId: sessionIdRef.current,
            runtimeId: activeRuntimeId,
            // 不传「默认」——后端不传 --model，用 CLI 自己的配置
            model: selectedModel !== 'default' ? selectedModel : undefined,
            reasoningEffort: selectedEffort || undefined,
            images: imagePayloads.length ? imagePayloads : undefined,
            // 此前轮次（闭包里是本轮发送前的列表）；dsh 等无会话运行时靠它做转写注入。
            // 带图轮次在转写里只留占位（转写注入是纯文本通道）。
            history: messages
              .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
              .map((m) => ({
                role: m.role,
                content: m.content + (m.attachments?.length ? ` [附题目图 ${m.attachments.length} 张]` : ''),
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
          };
          try { ev = JSON.parse(raw); } catch { return; }
          switch (ev.kind) {
            case 'text-delta':
              streamedText = true;
              patch(m => ({ ...m, content: (m.content ?? '') + (ev.text ?? '') }));
              break;
            case 'text':
              if (!streamedText) patch(m => ({ ...m, content: (m.content ?? '') + (ev.text ?? '') }));
              streamedText = false;
              break;
            case 'session':
              sessionIdRef.current = ev.sessionId;
              break;
            case 'tool-call':
            case 'tool-result': {
              const now = Date.now();
              if (ev.kind === 'tool-call') {
                setLoadingStatusText(`正在${toolStepLabel(ev.name ?? '')}…`);
                // 标题/类别是工具**入参**，AgentToolStep 不记入参，只能从事件流抓。
                const runMeta = metaFromToolCall(ev.name, ev.input);
                if (Object.keys(runMeta).length) {
                  patch(m => ({ ...m, meta: mergeRunMeta(m.meta, runMeta) }));
                }
              }
              else setLoadingStatusText('等待 Agent 回复…');
              patch(m => m.meta?.execution ? { ...m, meta: { ...m.meta,
                execution: updateToolProgress(m.meta.execution, ev, now) } } : m);
              break;
            }
            case 'error':
              sawError = true;
              reportFailure(typeof ev.message === 'string' ? ev.message : '没有返回具体错误信息。', 'runtime');
              break;
            case 'done':
              sawDone = true;
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
        if (controller.signal.aborted) stopped = true;
        else reportFailure(String(e instanceof Error ? e.message : e), 'request');
      } finally {
        const now = Date.now();
        if (abortRef.current === controller) abortRef.current = null;
        const status = stopped ? 'stopped' : sawError ? 'error' : sawDone ? 'completed' : 'unconfirmed';
        patch(m => m.meta?.execution ? { ...m, meta: { ...m.meta,
          status: stopped ? 'stopped' : sawError ? 'error' : 'completed',
          execution: finishExecution(m.meta.execution, status, now) } } : m);
        setIsLoading(false);
        setLoadingStatusText('准备就绪');
      }
    },
    [isLoading, activeRuntimeId, setIsLoading, recordFailure, clearFailure, messages, canSend, flush, windowId],
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 bg-[#FDFCF8] overflow-hidden">
      {/* 工具栏与画布共用一个工作区；全屏时保留同一个 Applet 实例。 */}
      <div
        ref={canvasWorkspaceRef}
        className={`flex min-h-0 min-w-0 flex-1 flex-col bg-white ${isFullscreen ? 'fixed inset-0 z-40 h-dvh w-screen' : 'relative h-full'}`}
      >
        <ControlDeck
          title={displayedTitle}
          saveStatusText={{ idle: '', dirty: '尚未保存', saving: '保存中…', saved: '已保存到本地', error: '保存／恢复失败', restoring: '恢复中…' }[courseware.status]}
          sliders={sliders}
          showAxes={showAxes}
          axesMixed={graphics.axes === 'mixed'}
          showGrid={showGrid}
          settingsOpen={graphics.settingsOpen}
          onToggleSettings={ggbApplet ? graphics.toggleSettings : undefined}
          isFullscreen={isFullscreen}
          onSliderChange={setSliderValue}
          onToggleAnimation={toggleSliderAnimation}
          onToggleAxes={handleToggleAxes}
          onToggleGrid={handleToggleGrid}
          onResetView={resetView}
          onToggleFullscreen={handleToggleFullscreen}
          onExport={handleExport}
        />
        {courseware.error && <div role="alert" className="flex shrink-0 items-center justify-between gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>{courseware.error}</span><button type="button" className="shrink-0 rounded px-2 py-1 underline focus-visible:outline-2 focus-visible:outline-amber-800" onClick={courseware.retry}>{courseware.retryLabel}</button>
        </div>}
        {exportError && (
          <div role="alert" className="flex shrink-0 items-center justify-between gap-3 bg-red-50 px-4 py-2 text-sm text-red-800">
            <span>{exportError}</span>
            <button type="button" aria-label="关闭导出提示" onClick={() => setExportError(null)} className="rounded p-1 hover:bg-red-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <CanvasStage onAppletReady={handleAppletReadyWithBridge} />
      </div>

      {/* 右侧 Agent 智能体对话面板 */}
      <ResizableChatRegion disabled={isFullscreen}>
        <AgentChatPanel
          messages={messages}
          conversationId={courseware.summary?.id}
          isLoading={isLoading}
          sendDisabled={!courseware.canSend}
          loadingStatusText={loadingStatusText}
          onSendMessage={handleSendMessage}
          onStopRun={stopRun}
          runtimes={runtimes}
          activeRuntimeId={activeRuntimeId}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
          selectedEffort={selectedEffort}
          onSelectEffort={handleSelectEffort}
          onSelectRuntime={handleSelectRuntime}
        />
      </ResizableChatRegion>

    </div>
  );
}
