import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** OpenCode 1.19.3 omits live text deltas and retry events in `run --format json`.
 * This per-run plugin bridges its public event hook, without intercepting model
 * requests, changing retry scheduling, or writing credentials to disk. */
export const OPENCODE_STATUS_PLUGIN = `
export default async ({ client }) => {
  let sessionID;
  let waiting = false;
  let failed = false;
  const assistants = new Set();
  const textParts = new Set();
  const emit = (status) => process.stdout.write(JSON.stringify({
    type: 'mathmover_status', sessionID, status,
  }) + '\\n');
  return {
    'chat.message': async (input) => {
      if (!sessionID) sessionID = input.sessionID;
    },
    event: async ({ event }) => {
      if (!sessionID || event.properties.sessionID !== sessionID || failed) return;
      const props = event.properties;
      if (event.type === 'message.updated') {
        if (props.info.role === 'assistant') assistants.add(props.info.id);
        return;
      }
      if (event.type === 'message.part.updated') {
        const part = props.part;
        // Reasoning uses the same delta field as public text; never forward it.
        if (assistants.has(part.messageID) && part.type === 'text' && !part.synthetic && !part.ignored) textParts.add(part.id);
        return;
      }
      if (event.type === 'message.part.delta') {
        if (assistants.has(props.messageID) && textParts.has(props.partID) && props.field === 'text' && props.delta) {
          process.stdout.write(JSON.stringify({ type: 'mathmover_text_delta', sessionID,
            messageID: props.messageID, partID: props.partID, delta: props.delta }) + '\\n');
        }
        return;
      }
      if (event.type !== 'session.status') return;
      const status = event.properties.status;
      if (status.type === 'retry') {
        const reason = status.action?.reason;
        if (reason === 'free_tier_limit' || reason === 'account_rate_limit' ||
            /insufficient_quota|FreeUsageLimitError|GoUsageLimitError|quota[_ ]exceeded|insufficient (?:credits?|balance)/i.test(status.message || '')) {
          failed = true;
          emit({ type: 'quota', message: '模型服务的可用额度已用尽。' });
          // Schedule outside the event callback so abort cannot block its bus.
          void client.session.abort({ path: { id: sessionID } }).catch(() => {});
          return;
        }
        waiting = true;
        emit({ type: 'retry', attempt: status.attempt, next: status.next,
          reason: /429|rate.?limit|too many requests/i.test(status.message || '') ? 'rate_limit' : 'unavailable' });
      } else if (waiting && status.type === 'busy') {
        waiting = false;
        emit({ type: 'busy' });
      }
    },
  };
};
`;

export function createOpenCodeStatusPlugin(tempDirectory = os.tmpdir()): { url: string; cleanup: () => void } {
  const directory = fs.mkdtempSync(path.join(tempDirectory, 'mm-opencode-status-'));
  const file = path.join(directory, 'status.mjs');
  try { fs.writeFileSync(file, OPENCODE_STATUS_PLUGIN, { mode: 0o600 }); }
  catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  return {
    url: pathToFileURL(file).href,
    cleanup: () => { try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* CLI may still be releasing the file on Windows. */ } },
  };
}
