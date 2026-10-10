import type { AppendMessage, ThreadMessageLike } from '@assistant-ui/react';
import type { AgentChatMessage, ChatAttachment } from '@/components/dashboard/types';

/** Presentation projection only: the host remains the source of truth and saves its own format. */
export function toAssistantMessage(message: AgentChatMessage): ThreadMessageLike {
  return {
    id: message.id, role: message.role, createdAt: new Date(message.createdAt),
    content: message.content ? [{ type: 'text', text: message.content }] : [],
    status: message.role === 'assistant'
      ? message.meta?.status === 'error' ? { type: 'incomplete', reason: 'error' }
      : message.meta?.execution?.status === 'running' || message.meta?.status === 'generating'
        ? { type: 'running' } : { type: 'complete', reason: 'stop' }
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
