'use client';

import { useAuiState } from '@assistant-ui/react';
import { AssistantMessage, UserMessage, EditComposer } from '@/components/assistant-ui/elements/thread.aui';
import { ToolGroupRoot, ToolGroupTrigger, ToolGroupContent } from '@/components/assistant-ui/elements/tool-group.aui';
import type { AgentChatMessage } from './types';
import AgentDiagnosticNotice from './AgentDiagnosticNotice';
import AgentExecutionProgress from './AgentExecutionProgress';
import AgentRunResult from './AgentRunResult';
import { useAgentRuntimeState } from './AgentRuntimeState';
import { agentFailure } from '@/lib/agent-diagnostics';

/** Only canvas metadata is supplied here; the message UI is assistant-ui's Thread. */
export default function AssistantChatMessage() {
  const msg = useAuiState(s => s.message.metadata.custom.mathmover as AgentChatMessage | undefined);
  const isEditing = useAuiState(s => s.message.composer.isEditing);
  const { detecting, refreshRuntimes } = useAgentRuntimeState();
  if (!msg) return null;
  const diagnostic = msg.role !== 'user' && msg.meta?.status === 'error'
    ? msg.meta.diagnostic ?? agentFailure({ stage: 'runtime', message: msg.meta.errorMessage || '没有返回具体错误信息。' }) : undefined;
  const commands = msg.meta?.commands ?? [];
  return <div data-chat-message={msg.role} data-chat-message-id={msg.id} className="min-w-0">
    {msg.role === 'user' ? <>
      {isEditing ? <EditComposer /> : <UserMessage />}
      {msg.attachments?.filter(image => image.unavailable || !image.url).map((image, index) =>
        <p key={image.id ?? index} className="mt-2 text-sm text-stone-600">旧图片无法恢复，请重新上传：{image.name || '题目图片'}</p>)}
    </> : <AssistantMessage
      before={msg.meta?.execution && <AgentExecutionProgress execution={msg.meta.execution} />}
      error={diagnostic && <AgentDiagnosticNotice diagnostic={diagnostic} detecting={detecting} onRescan={() => void refreshRuntimes()} />}
      after={<>
        <AgentRunResult meta={msg.meta} />
        {commands.length > 0 && <ToolGroupRoot variant="ghost" className="mt-2">
          <ToolGroupTrigger count={commands.length} label={`构造指令 · ${commands.length} 条`} />
          <ToolGroupContent><pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs"><code>{commands.join('\n')}</code></pre></ToolGroupContent>
        </ToolGroupRoot>}
      </>} />}
  </div>;
}
