import type { RuntimeDefinition } from './defs.ts';

/** One parser per child process: the public-event bridge and CLI completion both
 * describe the same text part. Reconcile by stable IDs, never shared global state
 * or text equality (distinct parts may legitimately contain identical text). */
export function createOpenCodeStreamParser(parse: RuntimeDefinition['parseLine']): RuntimeDefinition['parseLine'] {
  const parts = new Map<string, { text: string; complete: boolean }>();
  return line => {
    let event;
    try { event = JSON.parse(line); } catch { return parse(line); }
    if (!event || typeof event !== 'object') return parse(line);
    const delta = event.type === 'mathmover_text_delta';
    if (!delta && event.type !== 'text') return parse(line);
    const sessionId = event.sessionID;
    const messageId = delta ? event.messageID : event.part?.messageID;
    const partId = delta ? event.partID : event.part?.id;
    const text = delta ? event.delta : event.part?.text;
    if (![sessionId, messageId, partId].every(value => typeof value === 'string' && value.length > 0) || typeof text !== 'string') {
      return delta ? null : parse(line);
    }
    const key = JSON.stringify([sessionId, messageId, partId]);
    const previous = parts.get(key);
    if (previous?.complete) return null;
    if (delta) {
      if (!text) return null;
      parts.set(key, { text: (previous?.text ?? '') + text, complete: false });
      return { kind: 'text-delta', text, messageId };
    }
    parts.set(key, { text, complete: true });
    if (!previous) return parse(line); // Plugin unavailable/older CLI: retain whole-text fallback.
    // Completion is authoritative for a tail not yet delivered by the bridge.
    const tail = text.startsWith(previous.text) ? text.slice(previous.text.length) : '';
    return tail ? { kind: 'text-delta', text: tail, messageId } : null;
  };
}
