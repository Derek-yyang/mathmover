'use client';

import { useState } from 'react';
import { ActionBarPrimitive, MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { AlertTriangle, Check, Copy, Maximize2, Terminal } from 'lucide-react';
import type { AgentChatMessage } from './types';
import ChatMarkdown from './ChatMarkdown';
import AgentDiagnosticNotice from './AgentDiagnosticNotice';
import AgentExecutionProgress from './AgentExecutionProgress';
import { useAgentRuntimeState } from './AgentRuntimeState';
import { agentFailure } from '@/lib/agent-diagnostics';

export default function AssistantChatMessage({ onPreviewImage }: { onPreviewImage?: (url: string) => void }) {
  const msg = useAuiState(s => s.message.metadata.custom.mathmover as AgentChatMessage | undefined);
  const copied = useAuiState(s => s.message.isCopied);
  const { detecting, refreshRuntimes } = useAgentRuntimeState();
  const [commandsCopied, setCommandsCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  if (!msg) return null;
  const isUser = msg.role === 'user';
  const diagnostic = !isUser && msg.meta?.status === 'error'
    ? msg.meta.diagnostic ?? agentFailure({ stage: 'runtime', message: msg.meta.errorMessage || '没有返回具体错误信息。' }) : undefined;
  const cmds = msg.meta?.commands ?? [];
  const audit = msg.meta?.auditResult;
  const hasAuditIssues = !!(audit?.missing.length || audit?.undefinedObjs.length);
  return <MessagePrimitive.Root data-chat-message={msg.role}
    className={`group/message flex min-w-0 flex-col gap-2 ${isUser ? 'items-end' : 'items-stretch'}`}>
    {!isUser && <span className="text-xs font-medium text-stone-600">MathMover Agent</span>}
    {!isUser && msg.meta?.execution && <AgentExecutionProgress execution={msg.meta.execution} />}
    <div className={`min-w-0 text-sm leading-7 ${isUser ? 'max-w-[92%] rounded-2xl bg-stone-100 px-4 py-2.5 text-stone-900' : 'w-full text-stone-800'}`}>
      {msg.attachments?.length ? <div className="mb-2 flex flex-wrap gap-2">{msg.attachments.map((att, index) =>
        att.unavailable || !att.url ? <p key={att.id ?? index} className="text-xs">旧图片无法恢复，请重新上传：{att.name || '题目图片'}</p>
          : <button key={att.id ?? index} type="button" onClick={() => onPreviewImage?.(att.url)}
            aria-label={`预览图片：${att.name || '题目附件'}`} className="group relative max-w-full overflow-hidden rounded-lg border border-stone-200 focus-visible:outline-2 focus-visible:outline-emerald-700">
            <img src={att.url} alt={att.name || '题目附件'} className="max-h-48 max-w-full object-contain" />
            <Maximize2 aria-hidden className="absolute right-2 bottom-2 h-4 w-4 text-stone-700 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>)}</div> : null}
      {msg.content && <MessagePrimitive.Parts components={{ Text: ChatMarkdown }} />}
      {diagnostic && <AgentDiagnosticNotice diagnostic={diagnostic} detecting={detecting} onRescan={() => void refreshRuntimes()} />}
      {!isUser && msg.meta?.categoryLabel && <p className="mt-3 text-xs text-stone-600">{msg.meta.categoryLabel}{cmds.length ? ` · ${cmds.length} 条构造指令` : ''}</p>}
      {!isUser && hasAuditIssues && <div role="status" className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /><p>图形检查提示：{audit?.missing.length ? `${audit.missing.length} 个对象未建立；` : ''}{audit?.undefinedObjs.length ? `${audit.undefinedObjs.length} 个对象数值异常` : ''}</p>
      </div>}
      {!isUser && cmds.length > 0 && <details className="mt-3 rounded-lg bg-stone-100 text-xs leading-5">
        <summary className="cursor-pointer rounded-lg px-3 py-2 text-stone-700 focus-visible:outline-2 focus-visible:outline-emerald-700"><Terminal aria-hidden className="mr-1.5 inline h-3.5 w-3.5" />构造指令 · {cmds.length} 条</summary>
        <div className="px-3 pb-3"><button type="button" className="mb-2 rounded text-stone-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-emerald-700"
          onClick={async () => { try { await navigator.clipboard.writeText(cmds.join(String.fromCharCode(10))); setCommandsCopied(true); setCopyError(false); } catch { setCopyError(true); } }}>
          {copyError ? '复制失败，请手动选取' : commandsCopied ? '已复制指令' : '复制全部指令'}</button>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 font-mono text-xs">{cmds.join(String.fromCharCode(10))}</pre></div>
      </details>}
    </div>
    {msg.content && <ActionBarPrimitive.Root className="flex h-7 items-center opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none">
      <ActionBarPrimitive.Copy aria-label="复制消息" title="复制消息" className="rounded-md p-1.5 text-stone-600 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700">
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>}
  </MessagePrimitive.Root>;
}
