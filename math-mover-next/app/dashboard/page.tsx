'use client';

import { useState, useRef, useEffect, Suspense, useCallback } from 'react';
import { X } from 'lucide-react';
import ControlDeck from '@/components/dashboard/ControlDeck';
import AgentChatPanel from '@/components/dashboard/AgentChatPanel';
import { useAgentRuntimeState } from '@/components/dashboard/AgentRuntimeState';
import ResizableChatRegion from '@/components/dashboard/ResizableChatRegion';
import CanvasStage from '@/components/dashboard/CanvasStage';
import { useGgbSession } from '@/hooks/useGgbSession';
import { attachGgbBridge } from '@/lib/ggb-bridge';
import { agentFailure, agentResponseError } from '@/lib/agent-diagnostics';
import { finishExecution, updateToolProgress, toolStepLabel } from '@/lib/agent-progress';
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
  // 当前这一轮的取消句柄。用户点「停止」→ abort fetch → 流被取消 →
  // route 的 ReadableStream.cancel() 杀掉 agent 子进程（见 app/api/agent/route.ts）。
  const abortRef = useRef<AbortController | null>(null);
  const [loadingStatusText, setLoadingStatusText] = useState('准备就绪');

  // 视图控制
  const [showAxes, setShowAxes] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
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
      const controller = new AbortController();
      abortRef.current = controller;
      let stopped = false;

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
  } = useGgbSession();

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

  // ── Agent 运行时选择（PATH 扫描 + 用户自选，持久化） ──────────
  // 刻意**不自动降级**：用户选了哪个就用哪个，起不来就如实报错让他换。
  // 静默换 agent 会做出没预期的模型/风格，也掩盖真实的安装或鉴权问题。
  useEffect(() => {
    // 聊天顶部与设置共用选择；换 Agent 后不能续用旧运行时的 session。
    sessionIdRef.current = undefined;
  }, [activeRuntimeId]);

  const ledgerRef = useRef<string[]>([]);
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
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('画板恢复超时，未覆盖已保存的课件')), 15000);
        try { ggbApplet.setBase64!(record.ggbBase64!, () => { clearTimeout(timeout); resolve(); }); }
        catch (error) { clearTimeout(timeout); reject(error); }
      });
      refreshSliders(ggbApplet);
    } else if (record?.commands.length) await executeCommands(record.commands);
    else clearConstruction();
    if (record?.view) {
      setShowAxes(record.view.showAxes); setShowGrid(record.view.showGrid);
      setAxesVisible(record.view.showAxes); setGridVisible(record.view.showGrid);
      const b = record.view.bounds; if (b) ggbApplet.setCoordSystem?.(...b);
    } else { setShowAxes(true); setShowGrid(true); setAxesVisible(true); setGridVisible(true); }
    // Hook state may update its old command ledger during snapshot loading; the persisted one wins.
    ledgerRef.current = record?.commands ?? [];
    restoreCommandLedger(record?.commands ?? []);
  }, [ggbApplet, activeRuntimeId, refreshSliders, restoreCommandLedger, executeCommands, clearConstruction, setAxesVisible, setGridVisible]);
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
  const handleToggleAxes = () => {
    const next = !showAxes;
    setShowAxes(next);
    setAxesVisible(next);
  };

  // 切换网格显示
  const handleToggleGrid = () => {
    const next = !showGrid;
    setShowGrid(next);
    setGridVisible(next);
  };

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
          signal: controller.signal,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            windowId,
            sessionId: sessionIdRef.current,
            runtimeId: activeRuntimeId,
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
            toolCallId?: unknown; isError?: unknown;
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
              if (ev.kind === 'tool-call') setLoadingStatusText(`正在${toolStepLabel(ev.name ?? '')}…`);
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
          showGrid={showGrid}
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
          onSelectRuntime={handleSelectRuntime}
        />
      </ResizableChatRegion>

    </div>
  );
}
