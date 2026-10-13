'use client';

import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AssistantRuntimeProvider, SimpleImageAttachmentAdapter, ThreadPrimitive, useExternalStoreRuntime, type AttachmentAdapter } from '@assistant-ui/react';
import { ChevronDown, Loader2, Sparkles } from 'lucide-react';
import type { AgentChatMessage, ChatAttachment } from './types';
import AgentDiagnosticNotice from './AgentDiagnosticNotice';
import AssistantChatMessage from './AssistantChatMessage';
import AssistantChatComposer from './AssistantChatComposer';
import type { PickableModel } from './ComposerModelPicker';
import ConversationIndex from './ConversationIndex';
import { ImagePreviewProvider } from './ImagePreview';
import { useAgentRuntimeState } from './AgentRuntimeState';
import { toAssistantMessage, fromAssistantInput } from '@/lib/assistant-chat-adapter';
import { conversationTurns } from '@/lib/conversation-index';

export interface RuntimeOption {
  id: string; name: string; version: string | null; usable: boolean;
  /** 版本策略警告（未验证版本/拒启原因）；没问题不带。 */
  versionWarning?: string;
  authStatus?: 'ok' | 'missing' | 'unknown'; authMessage?: string; canAttachImages?: boolean;
  /** 该 agent 可选的模型（发现或兜底）。缺省/空 = 没得选，UI 藏掉模型控件。 */
  models?: { list: PickableModel[]; source?: 'live' | 'fallback' };
}
interface AgentChatPanelProps {
  messages: AgentChatMessage[]; isLoading: boolean; sendDisabled?: boolean;
  conversationId?: string; loadingStatusText?: string;
  onSendMessage: (text: string, attachments: ChatAttachment[]) => void | Promise<void>;
  onEditMessage?: (messageId: string, text: string, attachments: ChatAttachment[]) => void | Promise<void>;
  /** 停止当前这一轮（agent 正在跑时才用得上） */
  onStopRun?: () => void;
  runtimes?: RuntimeOption[];
  activeRuntimeId?: string; onSelectRuntime?: (id: string) => void;
  selectedModel?: string; onSelectModel?: (id: string) => void;
  selectedEffort?: string; onSelectEffort?: (id: string) => void;
}

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const subscribeReducedMotion = (notify: () => void) => {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const getReducedMotion = () => window.matchMedia(reducedMotionQuery).matches;
const getServerReducedMotion = () => true;

function ChatThread({ messages, isLoading, sendDisabled = false, loadingStatusText = '等待 Agent 回复…',
  onSendMessage, onEditMessage, onStopRun, canAttachImages,
  models, modelSource, selectedModel, onSelectModel,
  reasoningOptions, selectedEffort, onSelectEffort }: AgentChatPanelProps & {
    canAttachImages: boolean;
    models?: Array<PickableModel>;
    modelSource?: 'live' | 'fallback';
    reasoningOptions?: Array<{ id: string; label: string; default?: boolean }>;
  }) {
  const { detecting, detectionError, refreshRuntimes } = useAgentRuntimeState();
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [indexBrowsing, setIndexBrowsing] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, getServerReducedMotion);
  const turns = useMemo(() => conversationTurns(messages), [messages]);
  const imageAdapter = useMemo<AttachmentAdapter>(() => {
    const base = new SimpleImageAttachmentAdapter();
    return {
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      async add({ file }) {
        if (!canAttachImages) throw new Error('当前 Agent 没有图片通道。');
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请使用 PNG、JPEG、WebP 或 GIF 图片。');
        if (file.size > 6 * 1024 * 1024) throw new Error('单张题目图片不能超过 6 MB。');
        const pending = await base.add({ file });
        const complete = await base.send(pending);
        return { ...pending, content: complete.content };
      },
      remove: () => base.remove(),
      async send(attachment) {
        if (!canAttachImages) throw new Error('当前 Agent 没有图片通道，请移除图片或切换 Agent。');
        return { ...attachment, status: { type: 'complete' }, content: attachment.content ?? [] };
      },
    };
  }, [canAttachImages]);
  const runtime = useExternalStoreRuntime({
    messages, convertMessage: toAssistantMessage, isRunning: isLoading, isSendDisabled: sendDisabled,
    adapters: { attachments: imageAdapter },
    onEdit: onEditMessage ? async message => {
      if (isLoading || sendDisabled || !message.sourceId) return;
      setIndexBrowsing(false);
      const input = fromAssistantInput(message);
      await onEditMessage(message.sourceId, input.text, input.attachments);
    } : undefined,
    onNew: async message => {
      if (isLoading || sendDisabled) return;
      setIndexBrowsing(false);
      const input = fromAssistantInput(message);
      await onSendMessage(input.text, input.attachments);
    },
  });
  return <AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Root className="aui-root flex min-h-0 flex-1 flex-col" style={{ '--composer-radius': '1rem', '--composer-padding': '8px' } as React.CSSProperties}>
      <div className="relative min-h-0 flex-1">
        <ThreadPrimitive.Viewport ref={viewportRef} autoScroll={!indexBrowsing} scrollToBottomOnRunStart={!indexBrowsing}
          tabIndex={0} role="region" aria-label="聊天消息"
          className={`chat-scroll-viewport h-full overflow-x-hidden overflow-y-auto overscroll-contain pl-4 ${turns.length > 1 ? 'pr-9' : 'pr-4'} pt-5 pb-3 select-text focus-visible:outline-2 focus-visible:outline-emerald-700`}>
          {detectionError && <div className="mb-4"><AgentDiagnosticNotice diagnostic={detectionError} detecting={detecting} onRescan={() => void refreshRuntimes()} /></div>}
          <ThreadPrimitive.Empty>
            <div className="flex min-h-64 h-full flex-col items-center justify-center px-5 text-center">
              <Sparkles aria-hidden className="mb-4 h-6 w-6 text-emerald-700" />
              <h2 className="text-base font-semibold text-stone-800">把数学题变成动态图形</h2>
              <p className="mt-2 max-w-60 text-sm leading-6 text-stone-600">输入题目或上传题图，和 Agent 一起构建、调整画板上的模型。</p>
            </div>
          </ThreadPrimitive.Empty>
          <div ref={contentRef} className="space-y-6"><ThreadPrimitive.Messages>{() => <AssistantChatMessage />}</ThreadPrimitive.Messages></div>
          {isLoading && !messages.some(msg => msg.meta?.execution?.status === 'running') && <p role="status" className="mt-3 flex items-center gap-2 text-xs text-stone-600"><Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />{loadingStatusText}</p>}
          <ThreadPrimitive.ScrollToBottom behavior={reducedMotion ? 'instant' : 'smooth'} onClick={() => setIndexBrowsing(false)} aria-label="回到最新" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-stone-300 bg-white p-2 text-stone-700 hover:bg-stone-100 disabled:hidden focus-visible:outline-2 focus-visible:outline-emerald-700"><ChevronDown className="h-4 w-4" /></ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.Viewport>
        <ConversationIndex turns={turns} viewportRef={viewportRef} contentRef={contentRef} onNavigate={() => setIndexBrowsing(true)} />
      </div>
      <AssistantChatComposer canAttachImages={canAttachImages} isLoading={isLoading} onStopRun={onStopRun} getAttachmentCount={() => runtime.thread.composer.getState().attachments.length}
        models={models} modelSource={modelSource} selectedModel={selectedModel} onSelectModel={onSelectModel}
        reasoningOptions={reasoningOptions} selectedEffort={selectedEffort} onSelectEffort={onSelectEffort} />
    </ThreadPrimitive.Root>
  </AssistantRuntimeProvider>;
}

export default function AgentChatPanel(props: AgentChatPanelProps) {
  const { runtimes = [], activeRuntimeId, onSelectRuntime, isLoading, conversationId, selectedModel, onSelectModel, selectedEffort, onSelectEffort } = props;
  const canAttachImages = runtimes.find(runtime => runtime.id === activeRuntimeId)?.canAttachImages !== false;
  // 模型清单跟着当前 agent 走。只有「默认」一项时视为没得选（UI 藏控件）——
  // 清单以 agent 配置为唯一真相，不留手填入口（产品裁决 2026-10-12）。
  const active = runtimes.find(runtime => runtime.id === activeRuntimeId);
  const models = active?.models?.list ?? [];
  const modelSource = active?.models?.source;
  // 档位是**当前模型**的属性：换模型要跟着换，所以从选中项取，不从 agent 取。
  const selected = models.find((m) => m.id === (selectedModel || 'default')) ?? models[0];
  const reasoningOptions = selected?.reasoningOptions ?? [];
  return <aside aria-label="对话" className="flex h-full w-full min-w-0 shrink-0 flex-col overflow-hidden border-l border-[#E7E5E4] bg-[#FDFCF8]">
    <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[#E7E5E4] px-4">
      <span className="shrink-0 text-sm font-semibold text-stone-800">对话</span>
      {runtimes.length > 0 && <select aria-label="选择 Agent" value={activeRuntimeId ?? ''} onChange={event => onSelectRuntime?.(event.target.value)} disabled={isLoading}
        className="min-w-0 max-w-40 rounded-lg border border-stone-200 bg-transparent px-2 py-1 text-xs text-stone-700 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-60">
        {runtimes.map(runtime => <option key={runtime.id} value={runtime.id} disabled={!runtime.usable}>{runtime.name}{runtime.usable ? '' : '（未安装）'}{runtime.authStatus === 'missing' ? '（未登录）' : ''}</option>)}
      </select>}
    </div>
    <ImagePreviewProvider key={conversationId ?? 'new'}><ChatThread {...props} canAttachImages={canAttachImages}
      models={models} modelSource={modelSource} selectedModel={selectedModel} onSelectModel={onSelectModel}
        reasoningOptions={reasoningOptions} selectedEffort={selectedEffort} onSelectEffort={onSelectEffort} /></ImagePreviewProvider>
  </aside>;
}
