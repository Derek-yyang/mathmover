import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { CoursewareStore } from '../src/courseware-store.ts';
import { GgbBridgeClient } from '../src/bridge-client.ts';
import { GgbTools } from '../src/tools.ts';
import { listenHttp } from '../src/http-api.ts';
import { workspaceDir } from '../src/workspaces.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); });
async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mathmover-library-http-test-'));
  const store = new CoursewareStore(root); const bridge = new GgbBridgeClient({ port: 0 }); await bridge.start();
  const token = 'a'.repeat(64); const tools = new GgbTools(bridge, { workdir: root, includePng: false, pngMaxEdge: 900 });
  // 两个键各管一件事（与 cli.ts 同构）：id 找画布连接，coursewareId 定工作稿目录。
  const server = await listenHttp(tools, { port: 0, library: { store, bridge, token },
    toolsForWindow: (id, coursewareId) => new GgbTools(id ? bridge.forWindow(id) : bridge,
      { workdir: workspaceDir(root, coursewareId), includePng: false, pngMaxEdge: 900 }) });
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
  return { store, bridge, request, connect, port, root };
}
describe('library HTTP and window ownership', () => {
  it('rejects unauthenticated and cross-origin access', async () => {
    const s = await setup();
    expect((await fetch(`http://127.0.0.1:${s.port}/api/coursewares`)).status).toBe(403);
    expect((await s.request('/api/coursewares', { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await s.request('/api/coursewares')).status).toBe(200);
  });
  it('construction 读写端点返回真数组，不是被序列化的 Promise', async () => {
    // GgbTools.readConstruction 现在是 async。端点漏 await 会把 Promise 序列化成 {}
    // ——真 agent 走的就是这条路（mcp-stdio → HTTP），直接 .flatMap 就崩。
    const s = await setup();
    await s.request('/api/construction', { method: 'PUT', body: JSON.stringify({ commands: ['A = (0, 0)', 'B = (1, 1)'] }) });
    const got = await (await s.request('/api/construction')).json();
    expect(Array.isArray(got)).toBe(true);
    expect(got).toEqual(['A = (0, 0)', 'B = (1, 1)']);
  });
  it('工作稿按课件分目录：x-mathmover-courseware 决定读写哪一份', async () => {
    // 键是课件 id 而不是窗口 id：草稿是「当前画布的可编辑形态」，归课件所有。
    // 两份草稿互不串——这正是这次改动的目的。
    const s = await setup();
    const a = '3f2a9c10-8e1b-4c7d-9a2f-0b6e5d4c3b2a';
    const b = '9c8b7a60-1d2e-4f30-8a9b-7c6d5e4f3a2b';
    await s.request('/api/construction', { method: 'PUT', headers: { 'x-mathmover-courseware': a }, body: JSON.stringify({ commands: ['A = (0, 0)'] }) });
    await s.request('/api/construction', { method: 'PUT', headers: { 'x-mathmover-courseware': b }, body: JSON.stringify({ commands: ['B = (1, 1)'] }) });
    expect(await (await s.request('/api/construction', { headers: { 'x-mathmover-courseware': a } })).json()).toEqual(['A = (0, 0)']);
    expect(await (await s.request('/api/construction', { headers: { 'x-mathmover-courseware': b } })).json()).toEqual(['B = (1, 1)']);
    expect(fs.existsSync(path.join(s.root, 'workspaces', a, 'construction.ggb.txt'))).toBe(true);
  });
  it('课件头不合法一律 403（这个值要当目录名用）', async () => {
    const s = await setup();
    expect((await s.request('/api/construction', { headers: { 'x-mathmover-courseware': '../../escape' } })).status).toBe(403);
    expect((await s.request('/api/construction', { headers: { 'x-mathmover-courseware': 'a/b' } })).status).toBe(403);
  });
  it('永久删除课件时回收它的工作稿目录', async () => {
    const s = await setup();
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await s.request('/api/coursewares', { method: 'POST', body: JSON.stringify({ id, title: '待删', expectedRevision: 0, commands: [], messages: [] }) });
    await s.request('/api/construction', { method: 'PUT', headers: { 'x-mathmover-courseware': id }, body: JSON.stringify({ commands: ['A = (0, 0)'] }) });
    const dir = path.join(s.root, 'workspaces', id);
    expect(fs.existsSync(dir)).toBe(true);
    expect((await s.request('/api/coursewares/delete', { method: 'POST', body: JSON.stringify({ ids: [id] }) })).status).toBe(200);
    expect(fs.existsSync(dir)).toBe(false);
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
  it('exposes archive, unarchive and permanent deletion; rejects obsolete trash routes', async () => {
    const s = await setup(); const payload = { id: 'test', title: '测试', expectedRevision: 0, commands: [], messages: [] };
    expect((await s.request('/api/coursewares/import', { method: 'POST', body: JSON.stringify(payload) })).status).toBe(404);
    expect((await s.request('/api/coursewares', { method: 'POST', body: JSON.stringify(payload) })).status).toBe(200);
    expect((await s.request('/api/coursewares', { method: 'POST', body: JSON.stringify(payload) })).status).toBe(409);
    expect((await s.request('/api/coursewares/test')).status).toBe(200);
    expect((await (await s.request('/api/coursewares')).json()).capabilities).toEqual({ archive: true, permanentDelete: true });
    expect((await s.request('/api/coursewares/test/archive', { method: 'POST', body: '{"expectedRevision":1}' })).status).toBe(200);
    expect((await (await s.request('/api/coursewares')).json()).records).toHaveLength(0);
    expect((await (await s.request('/api/coursewares?archived=1')).json()).records).toHaveLength(1);
    expect((await (await s.request('/api/coursewares?archived=all')).json()).records).toHaveLength(1);
    expect((await s.request('/api/coursewares/test/unarchive', { method: 'POST', body: '{"expectedRevision":1}' })).status).toBe(409);
    expect((await s.request('/api/coursewares/test/unarchive', { method: 'POST', body: '{"expectedRevision":2}' })).status).toBe(200);
    expect((await (await s.request('/api/coursewares')).json()).records).toHaveLength(1);
    const previous = await (await s.request('/api/coursewares/test/versions/1')).json();
    expect(previous.revision).toBe(1); expect(previous.messages).toEqual([]);
    expect((await s.request('/api/coursewares?trash=1')).status).toBe(400);
    expect((await s.request('/api/coursewares/test/restore', { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await s.request('/api/coursewares/delete', { method: 'POST', body: JSON.stringify({ ids: ['test'] }) })).status).toBe(200);
    expect((await s.request('/api/coursewares/test')).status).toBe(404);
    expect((await s.request('/api/coursewares/test/versions/1')).status).toBe(404);
    expect((await s.request('/api/coursewares/test/versions')).status).toBe(404);
    expect((await (await s.request('/api/coursewares?archived=all')).json()).records).toHaveLength(0);
    expect((await s.request('/api/coursewares', { method: 'POST', body: JSON.stringify(payload) })).status).toBe(409);
    expect((await s.request('/api/coursewares/test/rename/extra', { method: 'POST', body: '{}' })).status).toBe(404);
  });
});
