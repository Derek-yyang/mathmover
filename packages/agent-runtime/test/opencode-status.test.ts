import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { createOpenCodeStatusPlugin, OPENCODE_STATUS_PLUGIN } from '../src/opencode-status.ts';
import { buildOpenCodeConfigContent } from '../src/opencode-config.ts';
import { opencode } from '../src/defs.ts';

describe('OpenCode retry bridge', () => {
  it('bridges only public assistant text in the active session, excluding user/reasoning/synthetic parts', async () => {
    const plugin = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(OPENCODE_STATUS_PLUGIN).toString('base64'));
    const hooks = await plugin.default({ client: { session: { abort: vi.fn() } } });
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const event = (type: string, properties: object) => hooks.event({ event: { type, properties: { sessionID: 'parent', ...properties } } });
    const part = (id: string, type: string, messageID = 'assistant', extra = {}) => event('message.part.updated', { part: { id, type, messageID, ...extra } });
    const delta = (partID: string, extra = {}) => event('message.part.delta', { messageID: 'assistant', partID, field: 'text', delta: '正文', ...extra });
    try {
      await hooks['chat.message']({ sessionID: 'parent' });
      await event('message.updated', { info: { id: 'assistant', role: 'assistant' } });
      await event('message.updated', { info: { id: 'user', role: 'user' } });
      await part('public', 'text');
      await part('reasoning', 'reasoning');
      await part('user', 'text', 'user');
      await part('internal', 'text', 'assistant', { synthetic: true });
      await part('ignored', 'text', 'assistant', { ignored: true });
      await delta('public', { sessionID: 'child' });
      await delta('public', { messageID: 'user' });
      await delta('public', { field: 'other' });
      await delta('reasoning');
      await delta('internal');
      await delta('ignored');
      await delta('user', { messageID: 'user' });
      await delta('missing');
      await delta('public', { delta: '' });
      expect(write).not.toHaveBeenCalled();
      await delta('public');
      expect(write).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(write.mock.calls[0][0]))).toEqual({
        type: 'mathmover_text_delta', sessionID: 'parent', messageID: 'assistant', partID: 'public', delta: '正文',
      });
      expect(String(write.mock.calls[0][0]).endsWith('\n')).toBe(true);
    } finally { write.mockRestore(); }
  });

  it('uses a disposable plugin without credentials in its source or configuration', () => {
    const plugin = createOpenCodeStatusPlugin();
    const file = fileURLToPath(plugin.url);
    try {
      expect(fs.readFileSync(file, 'utf8')).toBe(OPENCODE_STATUS_PLUGIN);
      const config = buildOpenCodeConfigContent({ statusPluginUrl: plugin.url,
        provider: { baseUrl: 'https://example.test/v1', model: 'mock', apiKey: 'secret-value' } })!;
      expect(JSON.parse(config).plugin).toEqual([plugin.url]);
      expect(config).not.toContain('secret-value');
      expect(OPENCODE_STATUS_PLUGIN).not.toContain('secret-value');
    } finally { plugin.cleanup(); }
    expect(fs.existsSync(file)).toBe(false);
    plugin.cleanup();
  });

  it('forwards actual retry deadlines for the active session and aborts exhausted quota once', async () => {
    // Execute exactly the JavaScript written for the real CLI (including NDJSON delimiters).
    const plugin = await import(/* @vite-ignore */ 'data:text/javascript;base64,' + Buffer.from(OPENCODE_STATUS_PLUGIN).toString('base64'));
    const abort = vi.fn().mockResolvedValue({});
    const hooks = await plugin.default({ client: { session: { abort } } });
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const status = (sessionID: string, value: unknown) => hooks.event({ event: { type: 'session.status', properties: { sessionID, status: value } } });
    try {
      await hooks['chat.message']({ sessionID: 'parent' });
      await status('child', { type: 'retry', action: { reason: 'free_tier_limit' } });
      await status('parent', { type: 'busy' });
      expect(write).not.toHaveBeenCalled();
      const next = Date.now() + 13_000;
      await status('parent', { type: 'retry', attempt: 2, next, message: 'Too Many Requests 429' });
      expect(abort).not.toHaveBeenCalled();
      await status('parent', { type: 'busy' });
      await status('parent', { type: 'retry', action: { reason: 'free_tier_limit' } });
      await status('parent', { type: 'retry', action: { reason: 'free_tier_limit' } });
      const frames = write.mock.calls.map(([value]) => {
        expect(String(value).endsWith('\n')).toBe(true);
        return JSON.parse(String(value));
      });
      expect(frames.map(frame => frame.status)).toEqual([
        { type: 'retry', attempt: 2, next, reason: 'rate_limit' },
        { type: 'busy' }, { type: 'quota', message: '模型服务的可用额度已用尽。' },
      ]);
      expect(abort).toHaveBeenCalledTimes(1);
      expect(abort).toHaveBeenCalledWith({ path: { id: 'parent' } });
    } finally { write.mockRestore(); }
  });

  it('normalizes status frames without accepting malformed deadlines or untrusted messages', () => {
    const parse = (status: unknown) => opencode.parseLine(JSON.stringify({ type: 'mathmover_status', sessionID: 'ses_1', status }));
    expect(parse({ type: 'quota', message: 'private secret' })).toEqual([
      { kind: 'session', sessionId: 'ses_1' },
      { kind: 'error', code: 'quota_exhausted', message: '模型服务的可用额度已用尽。' },
    ]);
    expect(parse({ type: 'retry', next: 123456, attempt: 2, reason: 'rate_limit' })).toEqual([
      { kind: 'session', sessionId: 'ses_1' }, { kind: 'retry', retryAt: 123456, attempt: 2, reason: 'rate_limit' },
    ]);
    expect(parse({ type: 'busy' })).toEqual([{ kind: 'session', sessionId: 'ses_1' }, { kind: 'retry', retryAt: null }]);
    for (const next of [null, -1, '123', NaN]) expect(parse({ type: 'retry', next, attempt: 1 })).toBeNull();
    expect(parse({ type: 'retry', next: 123, attempt: 0 })).toBeNull();
    expect(parse({ type: 'unknown' })).toBeNull();
  });
});
