import type { TranscriptTurn } from '@mathmover/agent-runtime';

/** Native sessions already own history; edited turns rebuild a fresh session from the retained prefix. */
export function agentRequestHistory(request: {
  history?: unknown; sessionId?: string; restartFromHistory?: boolean;
}, recomposesHistory = false): TranscriptTurn[] {
  if (!recomposesHistory && !(request.restartFromHistory === true && !request.sessionId)) return [];
  if (!Array.isArray(request.history)) return [];
  return request.history.filter((turn): turn is TranscriptTurn => typeof turn === 'object' && turn !== null
    && 'role' in turn && (turn.role === 'user' || turn.role === 'assistant')
    && 'content' in turn && typeof turn.content === 'string' && turn.content.trim().length > 0);
}
