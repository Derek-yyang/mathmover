import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/ggb-connection.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const { connectGgbDaemon } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const ticket = token => ({ ok: true, json: async () => ({ bindingToken: token }) });
function fixture(t, fetchBinding = async () => ticket('ticket')) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets = [], statuses = [], requests = [], messages = [];
  class Socket {
    sent = []; readyState = 0;
    constructor(url) { this.url = url; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    open() { this.readyState = 1; this.onopen?.(); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const originalSocket = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  t.after(() => { globalThis.WebSocket = originalSocket; });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, init });
    return fetchBinding(requests.length, init);
  });
  const connection = connectGgbDaemon({ windowId: 'test-window', wsUrl: 'ws://localhost:8787',
    onStatus: status => statuses.push(status), onMessage: event => messages.push(event.data) });
  t.after(connection.close);
  return { connection, sockets, statuses, requests, messages };
}

test('reports connecting then connected and preserves the window-bound hello and tool messages', async t => {
  const f = fixture(t);
  assert.deepEqual(f.statuses, ['connecting']);
  await settle();
  assert.equal(f.sockets.length, 1);
  f.sockets[0].open();
  assert.deepEqual(f.sockets[0].sent, [{ type: 'hello', version: 1, windowId: 'test-window', bindingToken: 'ticket' }]);
  assert.deepEqual(f.statuses, ['connecting', 'connected']);
  f.sockets[0].onmessage({ data: 'tool-call' });
  assert.deepEqual(f.messages, ['tool-call']);
  t.mock.timers.tick(10000); await settle();
  assert.equal(f.requests.length, 1, 'healthy connections do not poll or reconnect');
});

test('disconnect retries with a new binding ticket and clears stale socket callbacks', async t => {
  const f = fixture(t, async n => ticket(`ticket-${n}`));
  await settle(); f.sockets[0].open(); f.sockets[0].close();
  assert.equal(f.statuses.at(-1), 'disconnected');
  assert.equal(f.sockets[0].onmessage, null);
  t.mock.timers.tick(2000); await settle();
  assert.equal(f.statuses.at(-1), 'disconnected', 'background retries do not flicker the status');
  f.sockets[1].open();
  assert.equal(f.sockets[1].sent[0].bindingToken, 'ticket-2');
  assert.equal(f.statuses.at(-1), 'connected');
});

test('manual retry replaces a pending request; its late response cannot create another socket', async t => {
  let release;
  const f = fixture(t, n => n === 1 ? new Promise(resolve => { release = resolve; }) : ticket('fresh'));
  f.connection.reconnect();
  assert(f.requests[0].init.signal.aborted);
  await settle();
  release(ticket('stale')); await settle();
  assert.equal(f.sockets.length, 1);
  f.sockets[0].open();
  assert.equal(f.sockets[0].sent[0].bindingToken, 'fresh');
  t.mock.timers.tick(12000); await settle();
  assert.equal(f.requests.length, 2, 'old deadlines cannot disconnect the new socket');
});

test('stalled binding times out, retries, and disposal cancels all remaining work', async t => {
  let release;
  const f = fixture(t, () => new Promise(resolve => { release = resolve; }));
  t.mock.timers.tick(8000); await settle();
  assert(f.requests[0].init.signal.aborted);
  assert.equal(f.statuses.at(-1), 'disconnected');
  const statusCount = f.statuses.length;
  f.connection.close(); release(ticket('late')); await settle();
  t.mock.timers.tick(20000); await settle();
  f.connection.reconnect(); await settle();
  assert.equal(f.requests.length, 1);
  assert.equal(f.sockets.length, 0);
  assert.equal(f.statuses.length, statusCount);
});

test('a stalled WebSocket handshake times out; errors cannot schedule two retries', async t => {
  const f = fixture(t);
  await settle();
  const staleError = f.sockets[0].onerror, staleClose = f.sockets[0].onclose;
  t.mock.timers.tick(8000); await settle();
  assert.equal(f.sockets[0].readyState, 3);
  staleError(); staleClose();
  t.mock.timers.tick(2000); await settle();
  assert.equal(f.sockets.length, 2);
  f.sockets[1].open();
  assert.equal(f.statuses.at(-1), 'connected');
});

test('failed binding and missing tickets remain disconnected without claiming readiness', async t => {
  const f = fixture(t, async n => n === 1 ? { ok: false } : { ok: true, json: async () => ({}) });
  await settle();
  assert.equal(f.statuses.at(-1), 'disconnected');
  t.mock.timers.tick(2000); await settle();
  assert.equal(f.sockets.length, 0);
  assert.deepEqual(f.statuses, ['connecting', 'disconnected']);
  f.connection.reconnect(); await settle();
  assert.deepEqual(f.statuses.slice(-2), ['connecting', 'disconnected']);
});
