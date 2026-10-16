import type { AgentActivityEntry, AgentChatMessage } from '@/components/dashboard/types';

type Phase = 'commentary' | 'final';
export interface ActivityTextEvent { text?: string; messageId?: string; phase?: Phase }

function project(message: AgentChatMessage, activity: AgentActivityEntry[]): AgentChatMessage {
  return { ...message, content: activity.flatMap(entry => entry.kind === 'text' && (entry.phase === 'final' || entry.phase === 'unknown')
    ? [entry.text] : []).join('\n\n'), meta: { ...message.meta, activity } };
}

/** IDs and tool boundaries keep public narration ordered without inspecting its wording. */
export function appendActivityText(message: AgentChatMessage, event: ActivityTextEvent, complete = false): AgentChatMessage {
  if (!event.text) return message;
  const activity = [...(message.meta?.activity ?? [])];
  const last = activity.at(-1);
  const phase = event.phase ?? 'pending';
  if (last?.kind === 'text' && !last.complete && last.messageId === event.messageId && (!event.phase || last.phase === phase)) {
    activity[activity.length - 1] = { ...last, text: last.text + event.text, complete };
  } else activity.push({ id: `text-${activity.length}`, kind: 'text', text: event.text, phase, messageId: event.messageId, complete });
  return project(message, activity);
}

export function classifyActivityText(message: AgentChatMessage, phase: Phase, messageId?: string): AgentChatMessage {
  const activity = message.meta?.activity;
  if (!activity) return message;
  // An unscoped legacy marker belongs only to the current text, never earlier turns.
  const last = activity.findLast(entry => entry.kind === 'text');
  return project(message, activity.map(entry => entry.kind === 'text' && (messageId ? entry.messageId === messageId : entry === last)
    ? { ...entry, phase, complete: true } : entry));
}

export function recordActivityTool(message: AgentChatMessage, stepId: string, requested = true): AgentChatMessage {
  const activity = message.meta?.activity ?? [];
  if (activity.some(entry => entry.kind === 'tool' && entry.stepId === stepId)) return message;
  // A still-unclassified pre-tool message accompanies the tool request. Explicit
  // final-answer markers always win. No final answer is inferred from a tool ending.
  return project(message, [...activity.map(entry => requested && entry.kind === 'text' && entry.phase === 'pending'
    ? { ...entry, phase: 'commentary' as const, complete: true } : entry),
    { id: `tool-${stepId}`, kind: 'tool', stepId }]);
}

/** Resolve an authoritative result; otherwise leave unclassified output visible. */
export function settleActivity(message: AgentChatMessage, resultText?: string): AgentChatMessage {
  let activity = message.meta?.activity;
  if (!activity) return message;
  if (resultText?.trim()) {
    const exact = activity.filter(entry => entry.kind === 'text' && entry.text.trim() === resultText.trim());
    const finals = activity.filter(entry => entry.kind === 'text' && entry.phase === 'final');
    // Never promote an explicitly identified tool-round commentary as a final answer.
    if (exact.length === 1 && exact[0].kind === 'text' && exact[0].phase !== 'commentary') {
      activity = activity.map(entry => entry === exact[0] ? { ...entry, phase: 'final' as const } : entry);
    } else if (!finals.length && !exact.length) {
      activity = [...activity, { id: `text-${activity.length}`, kind: 'text', text: resultText, phase: 'final', complete: true }];
    }
  }
  return project(message, activity.map(entry => entry.kind === 'text' && entry.phase === 'pending'
    ? { ...entry, phase: 'unknown', complete: true } : entry));
}
