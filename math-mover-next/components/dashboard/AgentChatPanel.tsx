'use client';

import React, { useState, useRef } from 'react';
import {
  Send,
  Image as ImageIcon,
  X,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Sparkles,
  Loader2,
  Terminal,
  Maximize2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentChatMessage, ChatAttachment } from './types';
import AgentDiagnosticNotice from './AgentDiagnosticNotice';
import AgentExecutionProgress from './AgentExecutionProgress';
import { useChatAutoScroll } from '@/hooks/useChatAutoScroll';
import { useAgentRuntimeState } from './AgentRuntimeState';
import { agentFailure } from '@/lib/agent-diagnostics';

/** 可选的 agent 运行时（由 /api/agents 扫描 PATH 得到）。 */
export interface RuntimeOption {
  id: string;
  name: string;
  version: string | null;
  usable: boolean;
  /** 登录预检结论（声明了 authProbe 的运行时才有） */
  authStatus?: 'ok' | 'missing' | 'unknown';
  authMessage?: string;
}

interface AgentChatPanelProps {
  messages: AgentChatMessage[];
  isLoading: boolean;
  loadingStatusText?: string;
  onSendMessage: (text: string, attachments: ChatAttachment[]) => void;
  onPreviewImage?: (url: string) => void;
  /** 本机可用的 agent 列表；空数组表示尚未扫描 */
  runtimes?: RuntimeOption[];
  /** 当前选中的 agent id */
  activeRuntimeId?: string;
  onSelectRuntime?: (id: string) => void;
}

export default function AgentChatPanel({
  messages,
  isLoading,
  loadingStatusText = '等待 Agent 回复…',
  onSendMessage,
  onPreviewImage,
  runtimes = [],
  activeRuntimeId,
  onSelectRuntime,
}: AgentChatPanelProps) {
  const { detecting, detectionError, refreshRuntimes } = useAgentRuntimeState();
  const [inputText, setInputText] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [expandedCommands, setExpandedCommands] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { scrollRef, contentRef, onScroll, showLatest, backToLatest } = useChatAutoScroll(messages);

  // 处理文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const url = URL.createObjectURL(file);
      setAttachments((prev) => [
        ...prev,
        {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          url,
          name: file.name,
          contentType: file.type,
          file,
        },
      ]);
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 监听 Ctrl+V 粘贴截图
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          const url = URL.createObjectURL(file);
          setAttachments((prev) => [
            ...prev,
            {
              id: `paste_${Date.now()}`,
              url,
              name: '剪贴板图片.png',
              contentType: file.type,
              file,
            },
          ]);
        }
      }
    }
  };

  // 提交发送
  const handleSend = () => {
    if (isLoading) return;
    const trimmed = inputText.trim();
    if (!trimmed && attachments.length === 0) return;

    backToLatest(false);
    onSendMessage(trimmed, attachments);
    setInputText('');
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const removeAttachment = (id?: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const copyCommands = (cmds: string[], index: number) => {
    navigator.clipboard.writeText(cmds.join('\n'));
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const toggleCommandExpand = (msgId: string) => {
    setExpandedCommands((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  return (
    <aside className="w-full min-w-0 border-l border-[#E7E5E4] bg-[#FDFCF8] flex flex-col h-full shrink-0 select-none overflow-hidden">
      {/* 顶栏 */}
      <div className="h-14 border-b border-[#E7E5E4] px-4 flex items-center justify-between shrink-0 bg-white/50 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-semibold text-stone-800 text-sm">数学助教 Agent</span>
        </div>

        {/* Agent 选择器：PATH 扫描结果，不可用的置灰（不自动降级） */}
        {runtimes.length > 0 && (
          <select
            value={activeRuntimeId ?? ''}
            onChange={(e) => onSelectRuntime?.(e.target.value)}
            disabled={isLoading}
            title="选择用哪个 agent 驱动对话"
            className="text-xs text-stone-600 bg-white border border-[#E7E5E4] rounded-lg px-2 py-1
                       focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:opacity-50
                       max-w-[160px]"
          >
            {runtimes.map((r) => (
              <option key={r.id} value={r.id} disabled={!r.usable}>
                {r.name}
                {r.version ? ` · ${r.version}` : ''}
                {r.usable ? '' : '（未安装）'}
                {r.authStatus === 'missing' ? '（未登录）' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* 消息滚动流 */}
      <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={onScroll} tabIndex={0} role="region" aria-label="聊天消息"
        className="h-full overflow-y-auto overscroll-contain p-4 select-text [overflow-anchor:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600">
      <div ref={contentRef} className={`min-h-full space-y-4 ${messages.length === 0 && !detectionError ? 'h-full' : ''}`}>
        {detectionError && <AgentDiagnosticNotice diagnostic={detectionError}
          detecting={detecting} onRescan={() => void refreshRuntimes()} />}
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-stone-400">
            <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center mb-3 text-stone-400">
              <Sparkles className="w-6 h-6 text-emerald-600" />
            </div>
            <p className="text-sm font-medium text-stone-700 mb-1">开始你的数学课件探索</p>
            <p className="text-xs text-stone-400 max-w-[220px]">
              粘贴题目截图、上传图片或输入题目描述，Agent 将为你自动构建交互式 GeoGebra 几何模型。
            </p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            const diagnostic = !isUser && msg.meta?.status === 'error'
              ? msg.meta.diagnostic ?? agentFailure({ stage: 'runtime', message: msg.meta.errorMessage || '没有返回具体错误信息。' })
              : undefined;
            const isExpanded = !!expandedCommands[msg.id];
            const cmds = msg.meta?.commands || [];
            const hasAuditIssues =
              msg.meta?.auditResult &&
              (msg.meta.auditResult.missing.length > 0 ||
                msg.meta.auditResult.undefinedObjs.length > 0);

            return (
              <div
                key={msg.id || index}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1.5`}
              >
                {/* 消息发送方标识 */}
                <span className="text-[11px] text-stone-400 px-1 font-mono">
                  {isUser ? '你' : 'MathMover Agent'}
                </span>

                {!isUser && msg.meta?.execution && <AgentExecutionProgress execution={msg.meta.execution} />}

                {/* 消息主体气泡 */}
                {(msg.content || msg.attachments?.length || diagnostic || cmds.length > 0 || msg.meta?.categoryLabel || hasAuditIssues) && <div
                  className={`min-w-0 max-w-[92%] rounded-2xl p-3 text-sm leading-relaxed ${
                    isUser
                      ? 'bg-emerald-600 text-white rounded-tr-none shadow-sm'
                      : 'bg-white border border-[#E7E5E4] text-stone-800 rounded-tl-none shadow-xs'
                  }`}
                >
                  {/* 图片附件展示 */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mb-2 space-y-1.5">
                      {msg.attachments.map((att) => (
                        <div
                          key={att.id || att.url}
                          className="relative rounded-lg overflow-hidden border border-stone-200/50 group cursor-pointer"
                          onClick={() => onPreviewImage && onPreviewImage(att.url)}
                        >
                          <img
                            src={att.url}
                            alt="题目附件"
                            className="max-h-48 w-auto object-contain bg-stone-50 rounded-lg"
                          />
                          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                            <Maximize2 className="w-4 h-4" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 文本内容 */}
                  {msg.content && (!diagnostic || msg.meta?.diagnostic) && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                  {diagnostic && <div className={msg.content && msg.meta?.diagnostic ? 'mt-3' : ''}>
                    <AgentDiagnosticNotice diagnostic={diagnostic} detecting={detecting}
                      onRescan={() => void refreshRuntimes()} />
                  </div>}

                  {/* Agent 专家分类与状态 Badge */}
                  {!isUser && msg.meta?.categoryLabel && (
                    <div className="mt-2 pt-2 border-t border-stone-100 flex items-center justify-between text-xs text-stone-500">
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                        <Sparkles className="w-3 h-3" />
                        {msg.meta.categoryLabel}
                      </span>
                      {cmds.length > 0 && <span>已构建 {cmds.length} 条指令</span>}
                    </div>
                  )}

                  {/* 体检警示卡片 */}
                  {!isUser && hasAuditIssues && (
                    <div className="mt-2.5 p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold">图形体检提示</div>
                        <div className="text-[11px] text-amber-700">
                          {msg.meta?.auditResult?.missing.length ? `${msg.meta.auditResult.missing.length} 个对象未建立; ` : ''}
                          {msg.meta?.auditResult?.undefinedObjs.length ? `${msg.meta.auditResult.undefinedObjs.length} 个对象坐标异常` : ''}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* GGB 指令抽屉 (可折叠) */}
                  {!isUser && cmds.length > 0 && (
                    <div className="mt-2.5 border border-stone-200 rounded-lg overflow-hidden bg-stone-50">
                      <div
                        onClick={() => toggleCommandExpand(msg.id)}
                        className="px-2.5 py-1.5 flex items-center justify-between text-xs font-medium text-stone-600 cursor-pointer hover:bg-stone-100 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <Terminal className="w-3.5 h-3.5 text-stone-500" />
                          <span>GGB 指令清单 ({cmds.length})</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyCommands(cmds, index);
                            }}
                            title="复制全部指令"
                            className="p-1 hover:text-emerald-600 rounded"
                          >
                            {copiedIndex === index ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="p-2 border-t border-stone-200 bg-stone-900 text-stone-200 font-mono text-[11px] max-h-48 overflow-y-auto space-y-1">
                          {cmds.map((c, i) => (
                            <div key={i} className="leading-relaxed hover:bg-stone-800/80 px-1 rounded">
                              {c}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>}
              </div>
            );
          })
        )}

        {/* 思考状态占位 */}
        {isLoading && !messages.some(msg => msg.meta?.execution?.status === 'running') && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start space-y-1.5"
          >
            <div className="bg-white border border-stone-200 rounded-2xl rounded-tl-none p-3 shadow-xs flex items-center gap-2.5 text-stone-600 text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              <span>{loadingStatusText}</span>
            </div>
          </motion.div>
        )}

      </div>
      </div>
      {showLatest && <button type="button" onClick={() => backToLatest()}
        className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs text-stone-700 border border-stone-300 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />回到最新
      </button>}
      </div>

      {/* 底部输入框区 */}
      <div className="p-3 border-t border-[#E7E5E4] bg-white">
        {/* 待发送附件缩略展示 */}
        {attachments.length > 0 && (
          <div className="mb-2 flex items-center gap-2 overflow-x-auto py-1">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="relative group shrink-0 w-16 h-16 rounded-lg border border-stone-200 overflow-hidden bg-stone-50"
              >
                <img src={att.url} alt="附件预览" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeAttachment(att.id)}
                  className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 输入框与工具条 */}
        <div className="relative border border-stone-200 rounded-xl bg-stone-50 focus-within:bg-white focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 transition-all p-2">
          <textarea
            aria-label="题目描述"
            ref={textareaRef}
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="输入题目描述或粘贴截图 (Enter 发送)..."
            className="w-full bg-transparent resize-none text-xs text-stone-800 placeholder-stone-400 focus:outline-none leading-relaxed"
          />

          <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-stone-100">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="上传题目图片 (或直接在输入框 Ctrl+V 粘贴)"
                className="p-1.5 text-stone-500 hover:text-emerald-600 hover:bg-stone-100 rounded-lg transition-colors"
              >
                <ImageIcon className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              aria-label="发送消息"
              onClick={handleSend}
              disabled={isLoading || (!inputText.trim() && attachments.length === 0)}
              className={`p-1.5 rounded-lg flex items-center justify-center transition-colors ${
                isLoading || (!inputText.trim() && attachments.length === 0)
                  ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs'
              }`}
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
