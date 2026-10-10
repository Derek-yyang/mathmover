import type { AgentChatMessage } from '@/components/dashboard/types';

export interface ConversationTurn {
  id: string;
  number: number;
  preview: string;
  images: number;
}

export function conversationTurns(messages: AgentChatMessage[]): ConversationTurn[] {
  return messages.filter(message => message.role === 'user').map((message, index) => {
    const images = message.attachments?.length ?? 0;
    const text = message.content.trim().replace(/\s+/g, ' ');
    return { id: message.id, number: index + 1, images,
      preview: text ? Array.from(text).slice(0, 160).join('') : images ? `题目图片 · ${images} 张` : '未填写题目文字' };
  });
}

/** Offsets refer to user-message starts, including their complete assistant reply. */
export function readingTurnIndex(offsets: number[], scrollTop: number, height: number, scrollHeight: number): number {
  if (!offsets.length) return -1;
  if (scrollHeight > height && scrollTop + height >= scrollHeight - 2) return offsets.length - 1;
  let active = 0;
  for (let index = 0; index < offsets.length; index++) {
    if (offsets[index] > scrollTop + 32) break;
    active = index;
  }
  return active;
}
