import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasChannel, type Socket } from './channel';
import { listenTools } from './tool-http';
import type { ToolsLike } from '../../../packages/daemon/src/tools-http';

const channels: CanvasChannel[] = [];
afterEach(() => { channels.splice(0).forEach(channel => channel.dispose()); });
function channel() {
  const sent: any[] = [];
  const socket = {
    readyState: 1,
    send: (data: string) => { sent.push(JSON.parse(data)); },
    close: () => {},
    on: () => {},
  } as Socket;
  const value = new CanvasChannel(socket); channels.push(value); return { value, sent };
}
describe('online canvas transport', () => {
  it('isolates parallel canvases and matches responses by id', async () => {
    const a = channel(); const b = channel();
    const first = a.value.call('getState'); const second = b.value.call('getState');
    b.value.receive({ type: 'canvas-result', id: a.sent[0].id, payload: 'wrong canvas' });
    a.value.receive({ type: 'canvas-result', id: a.sent[0].id, payload: 'A' });
    b.value.receive({ type: 'canvas-result', id: b.sent[0].id, payload: 'B' });
    await expect(first).resolves.toBe('A'); await expect(second).resolves.toBe('B');
  });
  it('rejects pending calls on disconnect and permits a fresh connection', async () => {
    const a = channel(); const pending = a.value.call('apply');
    const rejection = expect(pending).rejects.toThrow('断开');
    a.value.dispose(); await rejection;
    await expect(a.value.call('ping')).rejects.toThrow('断开');
    const b = channel(); const ping = b.value.call('ping');
    b.value.receive({ type: 'canvas-result', id: b.sent[0].id, payload: true });
    await expect(ping).resolves.toBe(true);
  });
  it('bounds unresponsive canvas calls', async () => {
    await expect(channel().value.call('getState', undefined, 5)).rejects.toThrow('GGB_CALL_TIMEOUT');
  });
});
it('serves the existing MCP HTTP contract without exposing other runs or a courseware database', async () => {
  let draft = ['A=(0,0)'];
  const apply = vi.fn(async () => ({ applied: draft }));
  const tools = { getState: vi.fn(async () => ({ names: ['A'] })), apply,
    readConstruction: async () => draft, writeConstruction: async (commands: string[]) => { draft = commands; return 'construction.ggb.txt'; },
    reset: async () => { draft = []; }, ping: () => true } as unknown as ToolsLike;
  const { server, url } = await listenTools(tools);
  try {
    expect((await fetch(`${url}/api/state?png=0`).then(r => r.json())).names).toEqual(['A']);
    expect(tools.getState).toHaveBeenCalledWith({ png: false });
    await fetch(`${url}/api/construction`, { method: 'PUT', body: JSON.stringify({ commands: ['B=(1,1)'] }) });
    expect(await fetch(`${url}/api/construction`).then(r => r.json())).toEqual(['B=(1,1)']);
    await fetch(`${url}/api/apply`, { method: 'POST', body: JSON.stringify({ png: false, incremental: true }) });
    expect(apply).toHaveBeenCalledWith(undefined, { png: false, incremental: true });
    expect((await fetch(`${url}/api/state`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await fetch(new URL('/api/state', url))).status).toBe(403);
    expect((await fetch(`${url}/api/coursewares`)).status).toBe(404);
    await fetch(`${url}/api/reset`, { method: 'POST' }); expect(draft).toEqual([]);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
