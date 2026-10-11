import type { AppendMessage, ThreadMessageLike } from '@assistant-ui/react';
import type { AgentChatMessage, ChatAttachment } from '@/components/dashboard/types';

export type AssistantMessagePhase = 'running' | 'complete' | 'error' | 'stopped';

export function assistantMessagePhase(message: AgentChatMessage): AssistantMessagePhase {
  const meta = message.meta;
  if (!meta) return 'complete';
  // 用户主动打断：内容是残的，但既不是失败也不是正常结束
  if (meta.status === 'stopped' || meta.execution?.status === 'stopped') return 'stopped';
  if (meta.status === 'error' || meta.execution?.status === 'error' || meta.execution?.status === 'unconfirmed') return 'error';
  if (meta.status === 'generating' || meta.execution?.status === 'running') return 'running';
  return 'complete';
}

export function canCopyAgentMessage(message: AgentChatMessage): boolean {
  return message.content.trim().length > 0 && assistantMessagePhase(message) !== 'running';
}

/** Presentation projection only: the host remains the source of truth and saves its own format. */
export function toAssistantMessage(message: AgentChatMessage): ThreadMessageLike {
  const phase = assistantMessagePhase(message);
  return {
    id: message.id, role: message.role, createdAt: new Date(message.createdAt),
    content: message.content ? [{ type: 'text', text: message.content }] : [],
    attachments: message.attachments?.filter(image => !image.unavailable && image.url).map((image, index) => ({
      id: image.id ?? `${message.id}-image-${index}`, type: 'image' as const,
      name: image.name || '题目图片', contentType: image.contentType || 'image/png',
      status: { type: 'complete' as const }, content: [{ type: 'image' as const, image: image.url }],
    })),
    status: message.role === 'assistant'
      ? phase === 'error' ? { type: 'incomplete', reason: 'error' }
      : phase === 'stopped' ? { type: 'incomplete', reason: 'cancelled' }
      : phase === 'running' ? { type: 'running' } : { type: 'complete', reason: 'stop' }
      : undefined,
    // Domain metadata is rendered separately, never executed as frontend tools.
    metadata: { custom: { mathmover: message } },
  };
}

export function fromAssistantInput(message: AppendMessage): { text: string; attachments: ChatAttachment[] } {
  return {
    text: message.content.filter(part => part.type === 'text').map(part => part.text).join(String.fromCharCode(10)).trim(),
    attachments: (message.attachments ?? []).map(attachment => {
      const image = attachment.content.find(part => part.type === 'image');
      return { id: attachment.id, name: attachment.name, contentType: attachment.contentType,
        file: attachment.file, url: image?.type === 'image' ? image.image : '' };
    }),
  };
}

/** Editing continues from the turns before this user message. Unknown/stale IDs are rejected. */
export function historyBeforeUserMessage(messages: AgentChatMessage[], messageId: string): AgentChatMessage[] | null {
  const index = messages.findIndex(message => message.id === messageId);
  return index >= 0 && messages[index].role === 'user' ? messages.slice(0, index) : null;
}
