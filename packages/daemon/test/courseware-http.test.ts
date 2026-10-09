import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { CoursewareStore } from '../src/courseware-store.ts';
import { GgbBridgeClient } from '../src/bridge-client.ts';
import { GgbTools } from '../src/tools.ts';
import { listenHttp } from '../src/http-api.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mathmover-library-http-test-'));
  const store = new CoursewareStore(root); const bridge = new GgbBridgeClient({ port: 0 }); await bridge.start();
  const token = 'a'.repeat(64); const tools = new GgbTools(bridge, { workdir: root, includePng: false, pngMaxEdge: 900 });
  const server = await listenHttp(tools, { port: 0, library: { store, bridge, token }, toolsForWindow: id => new GgbTools(bridge.forWindow(id), { workdir: path.join(root, id), includePng: false, pngMaxEdge: 900 }) });
  const port = (server.address() as { port: number }).port;
  const wsPort = ((bridge as unknown as { wss: { address(): { port: number } } }).wss.address()).port;
  const sockets: WebSocket[] = [];
  cleanups.push(async () => { for (const socket of sockets) socket.terminate(); await bridge.stop(); await new Promise<void>(r => server.close(() => r())); store.close(); if (!root.startsWith(path.join(os.tmpdir(), 'mathmover-library-http-test-'))) throw new Error('Unsafe cleanup'); fs.rmSync(root, { recursive: true, force: true }); });
  const request = (route: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers: { 'content-type': 'application/json', 'x-mathmover-token': token, ...init?.headers } });
  async function connect(windowId: string, marker: string) {
    const binding = await (await request('/api/coursewares/windows', { method: 'POST', body: JSON.stringify({ windowId }) })).json();
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`); sockets.push(ws);
    await new Promise<void>((resolve, reject) => { ws.once('open', () => resolve()); ws.once('error', reject); });
    ws.on('message', raw => { const msg = JSON.parse(raw.toString()); ws.send(JSON.stringify({ id: msg.id, payload: { commands: [marker], names: [], objects: {}, sliders: [], png: null, pngSource: 'none', generation: 1 } })); });
    ws.send(JSON.stringify({ type: 'hello', windowId, bindingToken: binding.bindingToken }));
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2000;
      const check = () => { if (bridge.forWindow(windowId).connected) resolve(); else if (Date.now() > deadline) reject(new Error('Binding timeout')); else setTimeout(check, 5); }; check();
    });
    return ws;
  }
  return { store, bridge, request, connect, port };
}
describe('library HTTP and window ownership', () => {
  it('rejects unauthenticated and cross-origin access', async () => {
    const s = await setup();
    expect((await fetch(`http://127.0.0.1:${s.port}/api/coursewares`)).status).toBe(403);
    expect((await s.request('/api/coursewares', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await s.request('/api/coursewares')).status).toBe(200);
  });
  it('routes two windows to their own socket, never the newest global socket', async () => {
    const s = await setup(); await s.connect('window-a', 'A=(1,1)'); await s.connect('window-b', 'B=(2,2)');
    const a = await (await s.request('/api/state?png=0', { headers: { 'x-mathmover-window': 'window-a' } })).json();
    const b = await (await s.request('/api/state?png=0', { headers: { 'x-mathmover-window': 'window-b' } })).json();
    expect(a.commands).toEqual(['A=(1,1)']); expect(b.commands).toEqual(['B=(2,2)']);
  });
  it('never falls back when the requested canvas disconnects', async () => {
    const s = await setup(); const a = await s.connect('window-a', 'A=(1,1)'); await s.connect('window-b', 'B=(2,2)');
    await new Promise<void>(resolve => { a.once('close', () => resolve()); a.close(); });
    const result = await s.request('/api/state', { headers: { 'x-mathmover-window': 'window-a' } });
    expect(result.status).toBe(503); expect(s.bridge.forWindow('window-b').connected).toBe(true);
  });
  it('exposes save/read/conflict and trash operations', async () => {
    const s = await setup(); const payload = { id: 'test', title: '测试', expectedRevision: 0, commands: [], messages: [] };
    expect((await s.request('/api/coursewares', { method: 'POST', body: JSON.stringify(payload) })).status).toBe(200);
    expect((await s.request('/api/coursewares', { method: 'POST', body: JSON.stringify(payload) })).status).toBe(409);
    expect((await s.request('/api/coursewares/test')).status).toBe(200);
    await s.request('/api/coursewares/delete', { method: 'POST', body: JSON.stringify({ ids: ['test'] }) });
    expect((await (await s.request('/api/coursewares?trash=1')).json()).records).toHaveLength(1);
    await s.request('/api/coursewares/test/restore', { method: 'POST', body: '{}' });
    expect((await (await s.request('/api/coursewares')).json()).records).toHaveLength(1);
    const previous = await (await s.request('/api/coursewares/test/versions/1')).json();
    expect(previous.revision).toBe(1); expect(previous.messages).toEqual([]);
    expect((await s.request('/api/coursewares/test/rename/extra', { method: 'POST', body: '{}' })).status).toBe(404);
  });
});
