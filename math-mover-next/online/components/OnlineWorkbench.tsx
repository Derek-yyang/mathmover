'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { AgentRuntimeProvider, useAgentRuntimeState } from '@/components/dashboard/AgentRuntimeState';
import AgentChatPanel from '@/components/dashboard/AgentChatPanel';
import CanvasStage from '@/components/dashboard/CanvasStage';
import ControlDeck from '@/components/dashboard/ControlDeck';
import ResizableChatRegion from '@/components/dashboard/ResizableChatRegion';
import type { AgentChatMessage, ChatAttachment, CoursewareExportFormat } from '@/components/dashboard/types';
import type { AgentEvent } from '@mathmover/agent-runtime';
import { useGgbSession } from '@/hooks/useGgbSession';
import { useGgbGraphics } from '@/hooks/useGgbGraphics';
import { attachGgbBridge } from '@/lib/ggb-bridge';
import { prepareAgentImages } from '@/lib/agent-image-payload';
import { finishExecution, updateToolProgress } from '@/lib/agent-progress';
import { appendActivityText, classifyActivityText, recordActivityTool, settleActivity } from '@/lib/agent-activity';
import type { OnlineModelConfig } from '../model-config';
import type { PickableModel } from '@/components/dashboard/ComposerModelPicker';
import OnlineModelSettings from './OnlineModelSettings';

function connect() {
  const url = new URL('/api/run', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(url);
}

export default function OnlineWorkbench() {
  return <AgentRuntimeProvider><Workbench /></AgentRuntimeProvider>;
}

function Workbench() {
  const { runtimes } = useAgentRuntimeState();
  const runtime = runtimes.find(value => value.id === 'opencode');
  const defaultModelLabel = runtime?.models?.list.find(model => model.id === 'default')?.label ?? '默认模型';
  const [pages, setPages] = useState([{ id: 'initial', title: '未命名课件' }]);
  const [active, setActive] = useState('initial');
  const [sidebar, setSidebar] = useState(true);
  const [customModel, setCustomModel] = useState<OnlineModelConfig | null>(null);
  const [modelMode, setModelMode] = useState<'default' | 'custom'>('default');
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const rename = useCallback((id: string, title: string) => setPages(previous => previous.map(page => page.id === id ? { ...page, title } : page)), []);
  return <>
    <div className="flex h-dvh w-full overflow-hidden bg-[var(--mm-canvas-shell)] text-[var(--mm-text-stone-800)]">
      <aside aria-label="课件栏" className={`shrink-0 overflow-hidden border-r border-[var(--mm-border-stone-200)] transition-[width] duration-300 ${sidebar ? 'w-56' : 'w-12'}`}>
        <div className="flex h-14 items-center gap-2 px-3">
          {sidebar && <a href="https://mathmover.top" className="mr-auto flex items-center gap-2 font-semibold"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-700 text-white">M</span>MathMover</a>}
          <button aria-label={sidebar ? '收起课件栏' : '展开课件栏'} onClick={() => setSidebar(value => !value)}>{sidebar ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button>
        </div>
        {sidebar && <div className="w-56 p-3">
          <button className="mb-7 flex w-full items-center gap-2 rounded-lg p-2 text-sm text-emerald-700 hover:bg-emerald-50" onClick={() => { const id = crypto.randomUUID(); setPages(previous => [...previous, { id, title: '未命名课件' }]); setActive(id); }}><Plus size={16} />新建课件</button>
          <p className="mb-2 px-2 text-xs text-[var(--mm-text-stone-500)]">本次体验</p>
          {pages.map(page => <button key={page.id} onClick={() => setActive(page.id)} className={`mb-1 block w-full truncate rounded-lg px-2 py-2 text-left text-sm ${active === page.id ? 'bg-[var(--mm-bg-emerald-50)] text-[var(--mm-text-emerald-700)]' : 'hover:bg-[var(--mm-bg-stone-100)]'}`}>{page.title}</button>)}
          <p className="mt-6 px-2 text-xs leading-5 text-[var(--mm-text-stone-500)]">在线体验的记录仅保留在当前页面，刷新后清空。</p>
        </div>}
      </aside>
      <main className="relative min-w-0 flex-1">
        {pages.map(page => <div key={page.id} aria-hidden={active !== page.id} inert={active !== page.id} className={`absolute inset-0 ${active === page.id ? '' : 'invisible pointer-events-none'}`}>
          <Workspace id={page.id} title={page.title} active={active === page.id} onTitle={rename}
            customModel={customModel} modelMode={modelMode} onModelMode={setModelMode}
            onOpenModelSettings={() => setModelSettingsOpen(true)} defaultModelLabel={defaultModelLabel} />
        </div>)}
      </main>
    </div>
    <OnlineModelSettings open={modelSettingsOpen} onOpenChange={setModelSettingsOpen}
      current={customModel} defaultModelLabel={defaultModelLabel} defaultAvailable={Boolean(runtime?.usable)}
      onSave={config => { setCustomModel(config); setModelMode('custom'); }}
      onUseDefault={() => setModelMode('default')}
      onClear={() => { setCustomModel(null); setModelMode('default'); }} />
  </>;
}

function Workspace({ id, title, active, onTitle, customModel, modelMode, onModelMode, onOpenModelSettings, defaultModelLabel }: {
  id: string; title: string; active: boolean; onTitle: (id: string, title: string) => void;
  customModel: OnlineModelConfig | null; modelMode: 'default' | 'custom';
  onModelMode: (mode: 'default' | 'custom') => void; onOpenModelSettings: () => void;
  defaultModelLabel: string;
}) {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const ledger = useRef<string[]>([]);
  const transport = useRef<((op: string, args?: unknown) => Promise<unknown>) | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const { runtimes } = useAgentRuntimeState();
  const runtime = runtimes.find(value => value.id === 'opencode');
  const models: PickableModel[] = [
    { id: 'default', label: `默认 · ${defaultModelLabel}` },
    ...(customModel ? [{ id: 'custom', label: `自定义 · ${customModel.model}` }] : []),
  ];
  const selectedModel = modelMode === 'custom' && customModel ? 'custom' : 'default';
  const selectedModelReady = selectedModel === 'custom' ? Boolean(customModel) : Boolean(runtime?.usable);
  const displayRuntimes = runtimes.map(value => value.id === 'opencode'
    ? { ...value, usable: selectedModelReady, models: { ...value.models, list: models, source: 'live' as const } }
    : value);
  const selectModel = (id: string) => {
    if (id === 'custom') {
      if (customModel) onModelMode('custom');
      else onOpenModelSettings();
      return;
    }
    onModelMode('default');
  };
  const session = useGgbSession({ containerRef: canvasRef });
  const graphics = useGgbGraphics(session.ggbApplet);
  ledger.current = session.lastExecutedCommands;
  useEffect(() => {
    if (!session.ggbApplet) return;
    return attachGgbBridge(session.ggbApplet, {
      getLedger: () => ledger.current,
      onLedgerChange: commands => { ledger.current = commands; session.restoreCommandLedger(commands); },
      applyCommands: async ({ commands, incremental }) => {
        await session.executeCommands(commands, { incremental: incremental === true });
        return { applied: commands, failedFirstPass: [] };
      },
      canvasRoot: canvasRef.current ?? undefined,
      transport: request => { transport.current = request; return { close: () => { transport.current = null; }, reconnect: () => {} }; },
    });
  }, [session.ggbApplet, session.executeCommands, session.restoreCommandLedger]);
  useEffect(() => () => { abortRef.current?.abort(); socketRef.current?.close(); }, []);

  const send = async (text: string, attachments: ChatAttachment[]) => {
    if (sending.current || !transport.current) return;
    sending.current = true;
    const controller = new AbortController(); abortRef.current = controller;
    setBusy(true); setError('');
    const assistantId = crypto.randomUUID();
    const startedAt = Date.now();
    const patch = (update: (message: AgentChatMessage) => AgentChatMessage) => setMessages(previous => previous.map(message => message.id === assistantId ? update(message) : message));
    let sawDone = false; let sawError = false; let streamed = false;
    const report = (message: string) => { sawError = true; patch(value => ({ ...value, meta: { ...value.meta, errorMessage: message, status: 'error' } })); };
    const consume = (event: AgentEvent) => {
      switch (event.kind) {
        case 'title': if (title === '未命名课件') onTitle(id, event.title); break;
        case 'text-delta': streamed = true; patch(value => appendActivityText(value, event)); break;
        case 'text': if (!streamed) patch(value => appendActivityText(value, event, true)); streamed = false; break;
        case 'text-phase': patch(value => classifyActivityText(value, event.phase, event.messageId)); break;
        case 'tool-call': case 'tool-result':
          streamed = false;
          patch(value => {
            if (!value.meta?.execution) return value;
            const execution = updateToolProgress(value.meta.execution, event, Date.now());
            const next = { ...value, meta: { ...value.meta, execution } };
            const step = execution.steps.find(step => step.toolCallId === event.toolCallId);
            return step ? recordActivityTool(next, step.id, event.kind === 'tool-call') : next;
          }); break;
        case 'error': report(event.message); break;
        case 'done': sawDone = true; patch(value => settleActivity(value, event.resultText)); break;
      }
    };
    try {
      // Prepare all images before accepting the question; failed image reads never produce an incomplete send.
      const images = await prepareAgentImages(attachments, controller.signal);
      if (JSON.stringify(images).length > 28 * 1024 * 1024) throw new Error('题图总大小过大，请减少图片后重试。');
      setMessages(previous => [...previous,
        { id: crypto.randomUUID(), role: 'user', content: text, attachments, createdAt: startedAt },
        { id: assistantId, role: 'assistant', content: '', createdAt: startedAt,
          meta: { status: 'generating', execution: { status: 'running', startedAt, steps: [] } } }]);
      await new Promise<void>((resolve, reject) => {
        const socket = connect(); socketRef.current = socket;
        let finished = false;
        const timeout = setTimeout(() => { reject(new Error('生成连接等待超时。')); socket.close(); }, 295000);
        const handshake = setTimeout(() => { reject(new Error('无法连接云端生成服务，请稍后重试。')); socket.close(); }, 15000);
        const abort = () => { socket.close(); reject(new DOMException('已停止', 'AbortError')); };
        controller.signal.addEventListener('abort', abort, { once: true });
        socket.onopen = () => { clearTimeout(handshake); socket.send(JSON.stringify({ type: 'start', text, images,
          provider: selectedModel === 'custom' ? customModel : undefined,
          commands: ledger.current, history: messages.filter(value => ['user', 'assistant'].includes(value.role) && value.content).map(value => ({ role: value.role, content: value.content })) })); };
        socket.onmessage = async message => {
          const data = JSON.parse(message.data);
          if (data.type === 'event') consume(data.event);
          else if (data.type === 'finished') { finished = true; resolve(); }
          else if (data.type === 'canvas') {
            try {
              if (!transport.current) throw new Error('画板尚未就绪。');
              const payload = await transport.current(data.op, data.args);
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'canvas-result', id: data.id, payload }));
            } catch (error) {
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'canvas-result', id: data.id, error: error instanceof Error ? error.message : '画板执行失败。' }));
            }
          }
        };
        socket.onerror = () => reject(new Error('云端连接失败，请稍后重试。'));
        socket.onclose = () => { clearTimeout(timeout); clearTimeout(handshake); controller.signal.removeEventListener('abort', abort); if (!finished) reject(new Error('生成连接中断，本轮未能完成。')); };
      });
      if (!sawDone && !sawError) report('没有收到生成完成标记。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成失败。';
      if (!controller.signal.aborted) { report(message); setError(message); }
    } finally {
      const status = controller.signal.aborted ? 'stopped' : sawError || !sawDone ? 'error' : 'completed';
      patch(value => ({ ...settleActivity(value), meta: { ...settleActivity(value).meta, status,
        execution: value.meta?.execution ? finishExecution(value.meta.execution, status, Date.now()) : undefined } }));
      socketRef.current?.close(); socketRef.current = null; abortRef.current = null; sending.current = false; setBusy(false);
    }
  };
  const exportFile = async (format: CoursewareExportFormat) => {
    const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
    try {
      if (format === 'html') await session.exportHTML(`${safeTitle}.html`, title);
      else if (format === 'ggb') session.exportGGB(`${safeTitle}.ggb`);
      else if (!session.exportPNG(`${safeTitle}.png`)) setError('图片导出未成功，请稍后重试。');
    } catch { setError('导出未成功，请稍后重试。'); }
  };
  return <div className={`flex h-full w-full min-w-0 ${fullscreen ? 'fixed inset-0 z-50' : ''}`}>
    <div ref={canvasRef} className="flex min-w-0 flex-1 flex-col bg-[var(--mm-canvas-shell)]">
      <ControlDeck title={title} onRename={async value => onTitle(id, value)} renameDisabled={busy}
        boardDisabled={!session.isReady} showAxes={graphics.axes === 'all'} axesMixed={graphics.axes === 'mixed'} showGrid={graphics.showGrid}
        settingsOpen={graphics.settingsOpen} onToggleSettings={graphics.toggleSettings} isFullscreen={fullscreen}
        onToggleAxes={graphics.toggleAxes} onToggleGrid={graphics.toggleGrid} onResetView={session.resetView}
        onToggleFullscreen={() => setFullscreen(value => !value)} onExport={format => void exportFile(format)} />
      {error && <p role="alert" className="px-4 py-2 text-sm text-[var(--mm-text-amber-900)]">{error}</p>}
      {!selectedModelReady && <p role="status" className="px-4 py-2 text-sm text-[var(--mm-text-stone-500)]">默认模型服务未配置，可在输入框下方使用自己的模型。</p>}
      <div className="relative mx-2 mb-2 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-[var(--mm-border-stone-300)]">
        <CanvasStage onAppletReady={session.handleAppletReady} active={active} />
      </div>
    </div>
    <ResizableChatRegion disabled={fullscreen}>
      <AgentChatPanel editorId={id} messages={messages} isLoading={busy} sendDisabled={!session.isReady || !selectedModelReady}
        onSendMessage={send} onStopRun={() => abortRef.current?.abort()} runtimes={displayRuntimes} activeRuntimeId="opencode"
        selectedModel={selectedModel} onSelectModel={selectModel} onConfigureModel={onOpenModelSettings}
        />
    </ResizableChatRegion>
  </div>;
}
