import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocket } from 'ws';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createRuntime } = createRequire(import.meta.url)('../dist/runtime.cjs');

async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mathmover-mcp-test-'));
  const runtime = await createRuntime({ dataDir, distDir: path.join(root, 'dist') });
  const client = new Client({ name: 'test-agent', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await runtime.server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await runtime.close(); await fs.rm(dataDir, { recursive: true, force: true }); });
  return { dataDir, runtime, client };
}

const open = async (client, args = {}) => {
  const result = await client.callTool({ name: 'mathmover_open_canvas', arguments: args });
  assert.ok(!result.isError, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
};

async function startStdioClient(dataDir) {
  const client = new Client({ name: 'stdio-host', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'dist/cli.cjs'), '--data-dir', dataDir],
    stderr: 'pipe',
    cwd: os.tmpdir(),
  });
  await client.connect(transport);
  return { client, transport };
}

async function stopDaemon(dataDir) {
  try {
    const info = JSON.parse(await fs.readFile(path.join(dataDir, 'daemon.json'), 'utf8'));
    await fetch(`${info.origin}/api/control/shutdown`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${info.controlToken}` },
    });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        process.kill(info.pid, 0);
      } catch {
        return;
      }
      try {
        await fetch(`${info.origin}/api/control/health`, {
          headers: { Authorization: `Bearer ${info.controlToken}` },
        });
      } catch {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch {
    // The daemon may already be stopped.
  }
}

test('tools preserve the file-first workflow and require an explicit session', async t => {
  const { client } = await fixture(t);
  const tools = (await client.listTools()).tools;
  const apply = tools.find(tool => tool.name === 'ggb_apply');
  const openTool = tools.find(tool => tool.name === 'mathmover_open_canvas');
  const sopCards = tools.find(tool => tool.name === 'get_sop_cards');
  assert.ok(apply.inputSchema.required.includes('session_id'));
  assert.ok(!apply.inputSchema.properties.commands);
  assert.match(apply.description, /construction.ggb.txt/);
  assert.ok(sopCards.inputSchema.properties.names.anyOf);
  assert.match(openTool._meta.ui.resourceUri, /^ui:\/\/mathmover\/canvas-[a-f0-9]{12}\.html$/);
  assert.equal(openTool._meta.workbuddy.ui.launchSurface, 'panel');
  const resources = await client.listResources();
  assert.equal(resources.resources.length, 1);
  assert.equal(resources.resources[0].uri, openTool._meta.ui.resourceUri);
  const resource = await client.readResource({ uri: openTool._meta.ui.resourceUri });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(resource.contents[0].text, /<iframe/);
  assert.deepEqual(resource.contents[0]._meta.ui.csp.frameDomains, ['http://127.0.0.1:*']);
  const missing = await client.callTool({ name: 'ggb_get_state', arguments: {} });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /session_id/);
  const expert = await client.callTool({ name: 'get_expert_prompt', arguments: { category: 'C' } });
  assert.ok(!expert.isError);
  assert.ok(expert.content[0].text.length > 1000);
  const wrappedCards = await client.callTool({
    name: 'get_sop_cards',
    arguments: { names: { item: ['curve-definition', 'moving-point-path'] } },
  });
  assert.ok(!wrappedCards.isError, JSON.stringify(wrappedCards));
  assert.ok(wrappedCards.content.length >= 2);
  const singleCard = await client.callTool({ name: 'get_sop_cards', arguments: { names: 'curve-definition' } });
  assert.ok(!singleCard.isError, JSON.stringify(singleCard));
  assert.ok(singleCard.content[0].text.includes('curve-definition'));
  const jsonStringCards = await client.callTool({
    name: 'get_sop_cards',
    arguments: { names: '["curve-definition","moving-point-path"]' },
  });
  assert.ok(!jsonStringCards.isError, JSON.stringify(jsonStringCards));
  assert.ok(jsonStringCards.content.length >= 2);
});

test('sessions have independent files, capabilities and persisted identities', async t => {
  const { client, runtime, dataDir } = await fixture(t);
  const first = await open(client, { title: '椭圆题' });
  const second = await open(client, { title: '函数题' });
  assert.notEqual(first.session_id, second.session_id);
  assert.notEqual(first.workfile, second.workfile);
  assert.ok(first.workfile.startsWith(dataDir));
  await fs.writeFile(first.workfile, 'A=(1,2)\n');
  assert.equal(await fs.readFile(second.workfile, 'utf8'), '');
  const resumed = await open(client, { session_id: first.session_id });
  assert.equal(resumed.workfile, first.workfile);
  assert.equal(await fs.readFile(first.workfile, 'utf8'), 'A=(1,2)\n');
  const firstResult = await client.callTool({ name: 'mathmover_open_canvas', arguments: { session_id: first.session_id } });
  assert.equal(firstResult._meta['workbuddy.ai/artifact'].stableId, first.session_id);
  assert.equal(firstResult._meta['workbuddy.ai/artifact'].title, '椭圆题');
  const list = await client.callTool({ name: 'mathmover_list_canvases', arguments: {} });
  assert.equal(JSON.parse(list.content[0].text).length, 2);
  const noToken = await fetch(`${runtime.origin}/api/sessions/${first.session_id}`);
  assert.equal(noToken.status, 403);
  const token = new URLSearchParams(new URL(first.url).hash.slice(1)).get('token');
  const sessionResponse = await fetch(`${runtime.origin}/api/sessions/${first.session_id}`, { headers: { Authorization: `Bearer ${token}` } });
  const sessionPayload = await sessionResponse.json();
  assert.equal(sessionPayload.accessToken, undefined);
  const crossSession = await fetch(`${runtime.origin}/api/sessions/${second.session_id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(crossSession.status, 403);
  const crossOrigin = await fetch(`${runtime.origin}/api/sessions/${first.session_id}`, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://example.com' } });
  assert.equal(crossOrigin.status, 403);
  const traversal = await client.callTool({ name: 'mathmover_open_canvas', arguments: { session_id: '../../outside' } });
  assert.equal(traversal.isError, true);
});

test('disconnects are explicit and preserve the draft; reconnect restores the same session', async t => {
  const { client } = await fixture(t);
  const canvas = await open(client);
  await fs.writeFile(canvas.workfile, 'A=(1,2)\n');
  const result = await client.callTool({ name: 'ggb_apply', arguments: { session_id: canvas.session_id, png: false } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /GGB_SESSION_DEAD/);
  assert.equal(await fs.readFile(canvas.workfile, 'utf8'), 'A=(1,2)\n');
});

test('the MCP library manages persisted courseware with separate authorization and recoverable deletion', async t => {
  const { client, runtime, dataDir } = await fixture(t);
  const first = await open(client, { title: '原来的课件' });
  await fs.writeFile(first.workfile, 'P=(1,2)\n');
  const token = new URLSearchParams(new URL(first.url).hash.slice(1)).get('token');
  const session = await fetch(`${runtime.origin}/api/sessions/${first.session_id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  const headers = { Authorization: `Bearer ${session.managementToken}`, 'Content-Type': 'application/json' };
  const request = (suffix = '', init = {}) => fetch(`${runtime.origin}/api/canvases${suffix}`, { ...init, headers: { ...headers, ...init.headers } });
  assert.match(session.managementToken, /^[a-f0-9]{64}$/);
  assert.notEqual(session.managementToken, token);
  assert.equal((await fetch(`${runtime.origin}/api/canvases`)).status, 403);
  assert.equal((await request('', { headers: { Authorization: `Bearer ${token}` } })).status, 403);
  assert.equal((await request('', { headers: { Origin: 'https://example.com' } })).status, 403);
  const renamed = await request(`/${first.session_id}`, { method: 'PATCH', body: JSON.stringify({ title: '  椭圆与动点  ' }) });
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).title, '椭圆与动点');
  assert.equal((await open(client, { session_id: first.session_id })).title, '椭圆与动点');
  assert.equal((await request(`/${first.session_id}`, { method: 'PATCH', body: JSON.stringify({ title: ' ' }) })).status, 400);
  assert.equal((await request('', { method: 'POST', body: JSON.stringify({ title: 'x'.repeat(101) }) })).status, 400);
  const created = await request('', { method: 'POST', body: JSON.stringify({ title: '另一份课件' }) }).then(r => r.json());
  assert.notEqual(created.session_id, first.session_id);
  assert.equal(await fs.readFile(created.workfile, 'utf8'), '');
  const resumed = await request(`/${first.session_id}`, { method: 'POST', body: '{}' }).then(r => r.json());
  assert.equal(resumed.url, first.url);
  const all = await request().then(r => r.json());
  assert.equal(all.length, 2);
  assert.ok(all.every(item => !('accessToken' in item)));
  const deleted = await request(`/${first.session_id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal((await request().then(r => r.json())).length, 1);
  await assert.rejects(fs.stat(first.workfile), /ENOENT/);
  const archived = await fs.readdir(path.join(dataDir, 'trash'));
  assert.equal(await fs.readFile(path.join(dataDir, 'trash', archived[0], 'construction.ggb.txt'), 'utf8'), 'P=(1,2)\n');
  const restoredMetadata = JSON.parse(await fs.readFile(path.join(dataDir, 'trash', archived[0], 'session.json'), 'utf8'));
  assert.equal(restoredMetadata.title, '椭圆与动点');
  const staleTool = await client.callTool({ name: 'ggb_get_state', arguments: { session_id: first.session_id, png: false } });
  assert.equal(staleTool.isError, true);
  const staleOpen = await client.callTool({ name: 'mathmover_open_canvas', arguments: { session_id: first.session_id } });
  assert.equal(staleOpen.isError, true);
});

test('canvas calls are routed by session, not by most recently opened tab', async t => {
  const { runtime, client } = await fixture(t);
  const first = await open(client);
  const second = await open(client);
  const sockets = [];
  for (const [canvas, name] of [[first, 'A'], [second, 'B']]) {
    const token = new URLSearchParams(new URL(canvas.url).hash.slice(1)).get('token');
    const socket = new WebSocket(`${runtime.origin.replace('http:', 'ws:')}/ws/${canvas.session_id}?token=${token}`, { origin: runtime.origin });
    socket.on('message', data => {
      const message = JSON.parse(data.toString());
      socket.send(JSON.stringify({ id: message.id, payload: { names: [name], commands: [`${name}=(0,0)`], objects: [{ name, type: 'point', independent: true }], sliders: [], generation: 1 } }));
    });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    sockets.push(socket);
  }
  t.after(() => sockets.forEach(socket => socket.terminate()));
  const one = await client.callTool({ name: 'ggb_get_state', arguments: { session_id: first.session_id, png: false } });
  const two = await client.callTool({ name: 'ggb_get_state', arguments: { session_id: second.session_id, png: false } });
  assert.match(one.content[0].text, /A/);
  assert.match(two.content[0].text, /B/);
});

test('a normal stdio host can start the distributable without Electron or Next', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mathmover-mcp-stdio-'));
  const { client, transport } = await startStdioClient(dataDir);
  let stderr = '';
  transport.stderr?.on('data', bytes => { stderr += bytes; });
  t.after(async () => {
    await client.close();
    await stopDaemon(dataDir);
    await fs.rm(dataDir, { recursive: true, force: true });
  });
  const canvas = await open(client, { title: '独立启动' });
  assert.ok(canvas.url.startsWith('http://127.0.0.1:'));
  assert.equal((await fetch(canvas.url)).status, 200);
  assert.ok(!stderr.includes('Error'));
});

test('delivery preview takes over the same session without closing the service', async t => {
  const { runtime, client } = await fixture(t);
  const canvas = await open(client);
  const token = new URLSearchParams(new URL(canvas.url).hash.slice(1)).get('token');
  const url = `${runtime.origin.replace('http:', 'ws:')}/ws/${canvas.session_id}?token=${token}`;
  const connect = async name => {
    const socket = new WebSocket(url, { origin: runtime.origin });
    t.after(() => socket.terminate());
    socket.on('message', bytes => {
      const { id } = JSON.parse(bytes.toString());
      socket.send(JSON.stringify({ id, payload: { names: [name], commands: [], objects: [], sliders: [], generation: 1 } }));
    });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    return socket;
  };
  const first = await connect('generation-panel');
  const closed = new Promise(resolve => first.once('close', code => resolve(code)));
  const second = await connect('delivery-preview');
  assert.equal(await closed, 4001);
  const result = await client.callTool({ name: 'ggb_get_state', arguments: { session_id: canvas.session_id, png: false } });
  assert.ok(!result.isError, JSON.stringify(result));
  assert.match(result.content[0].text, /delivery-preview/);
  first.terminate();
  assert.equal(second.readyState, WebSocket.OPEN);
  assert.equal((await fetch(canvas.url)).status, 200);
});

test('the canvas outlives the MCP host and the next host resumes the same live session', async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mathmover-mcp-lifecycle-'));
  let firstClient;
  let secondClient;
  let socket;
  t.after(async () => {
    socket?.terminate();
    await firstClient?.close();
    await secondClient?.close();
    await stopDaemon(dataDir);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  ({ client: firstClient } = await startStdioClient(dataDir));
  const first = await open(firstClient, { title: '跨任务保留' });
  const token = new URLSearchParams(new URL(first.url).hash.slice(1)).get('token');
  const origin = new URL(first.url).origin;
  socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws/${first.session_id}?token=${token}`, { origin });
  socket.on('message', data => {
    const message = JSON.parse(data.toString());
    socket.send(JSON.stringify({
      id: message.id,
      payload: {
        names: ['P'],
        commands: ['P=(1,2)'],
        objects: [{ name: 'P', type: 'point', independent: true }],
        sliders: [],
        generation: 1,
      },
    }));
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  await firstClient.close();
  firstClient = undefined;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(socket.readyState, WebSocket.OPEN);
  assert.equal((await fetch(first.url)).status, 200);

  ({ client: secondClient } = await startStdioClient(dataDir));
  const resumed = await open(secondClient, { session_id: first.session_id });
  assert.equal(new URL(resumed.url).origin, origin);
  assert.equal(resumed.url, first.url);
  assert.equal(resumed.connected, true);
  const state = await secondClient.callTool({
    name: 'ggb_get_state',
    arguments: { session_id: first.session_id, png: false },
  });
  assert.ok(!state.isError, JSON.stringify(state));
  assert.match(state.content[0].text, /P/);

  await secondClient.close();
  secondClient = undefined;
  socket.terminate();
  socket = undefined;
  const stopped = execFileSync(process.execPath, [
    path.join(root, 'dist/cli.cjs'),
    '--data-dir',
    dataDir,
    '--shutdown-daemon',
  ], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.match(stopped, /已停止/);
});
