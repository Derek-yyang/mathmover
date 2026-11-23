import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { MCP_APP_HTML, MCP_APP_URI } from '../src/mcp-app.ts';
import { checkExportSupport, STALE_EXPORT_PANEL } from '../src/export-bridge.ts';

function fixture(capabilities = { downloadFile: {} }) {
  const listeners = {}, requests = [], replies = [];
  const child = { postMessage: message => replies.push(message) };
  const frame = { src: 'http://127.0.0.1:1234/canvas/test', contentWindow: child, addEventListener() {} };
  const parent = { postMessage: request => requests.push(request) };
  const state = { classList: { add() {}, remove() {} } };
  const document = { getElementById: id => id === 'canvas' ? frame : state, documentElement: {} };
  const window = { parent, addEventListener: (type, fn) => { listeners[type] = fn; } };
  const context = vm.createContext({ window, document, URL, Map, setTimeout, clearTimeout, ResizeObserver: class { observe() {} } });
  vm.runInContext(MCP_APP_HTML.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  const deliver = (source, data, origin = 'http://127.0.0.1:1234') => listeners.message({ source, data, origin });
  const initialize = async () => {
    deliver(parent, { jsonrpc: '2.0', id: requests[0].id, result: { hostCapabilities: capabilities } });
    await Promise.resolve();
  };
  const resource = { uri: 'file:///%E6%A4%AD%E5%9C%86.ggb', mimeType: 'application/vnd.geogebra.file', blob: 'UEsDBA==' };
  const send = (source = child, origin) => deliver(source, { type: 'mathmover:export', requestId: 'test-export', resource }, origin);
  return { requests, replies, child, parent, initialize, send, deliver };
}

test('embedded export transfers bytes through the host and waits for its save result', async () => {
  const f = fixture(); await f.initialize(); f.send();
  const request = f.requests.find(r => r.method === 'ui/download-file');
  assert.equal(request.params.contents[0].resource.blob, 'UEsDBA==');
  assert.equal(f.replies.length, 0);
  f.deliver(f.parent, { jsonrpc: '2.0', id: request.id, result: {} });
  await Promise.resolve();
  assert.equal(f.replies[0].requestId, 'test-export');
  assert.equal(f.replies[0].error, undefined);
});

test('unsupported hosts report an error instead of attempting a blocked browser download', async () => {
  const f = fixture({}); await f.initialize(); f.send();
  assert.match(f.replies[0].error, /不支持文件下载/);
  assert.equal(f.requests.some(r => r.method === 'ui/download-file'), false);
});

test('exports reject foreign frames and origins', async () => {
  const f = fixture(); await f.initialize();
  f.send({}, 'http://127.0.0.1:1234');
  f.send(f.child, 'https://example.com');
  assert.equal(f.requests.some(r => r.method === 'ui/download-file'), false);
  assert.equal(f.replies.length, 0);
});

test('host cancellation and failures never report successful export', async () => {
  for (const error of ['User cancelled', 'Disk full']) {
    const f = fixture(); await f.initialize(); f.send();
    const request = f.requests.find(r => r.method === 'ui/download-file');
    f.deliver(f.parent, { jsonrpc: '2.0', id: request.id, result: { isError: true, error } });
    await Promise.resolve();
    assert.match(f.replies[0].error, error === 'User cancelled' ? /已取消/ : /Disk full/);
  }
});

test('the resource URI changes with the wrapper contents to invalidate host caches', () => {
  const hash = createHash('sha256').update(MCP_APP_HTML).digest('hex').slice(0, 12);
  assert.equal(MCP_APP_URI, `ui://mathmover/canvas-${hash}.html`);
});

test('the wrapper acknowledges export support without starting a save dialog', async () => {
  const f = fixture(); await f.initialize();
  f.deliver(f.child, { type: 'mathmover:export-support', requestId: 'support' });
  assert.equal(f.replies[0].version, 1);
  assert.equal(f.replies[0].error, undefined);
  assert.equal(f.requests.some(r => r.method === 'ui/download-file'), false);
});

test('a cached legacy panel fails the preflight promptly and removes its listener', async t => {
  const previous = globalThis.window;
  const listeners = new Set();
  globalThis.window = { parent: { postMessage() {} }, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  t.after(() => { globalThis.window = previous; });
  await assert.rejects(checkExportSupport(10), { message: STALE_EXPORT_PANEL });
  assert.equal(listeners.size, 0);
});

test('a current panel completes the preflight, ignoring replies from other frames', async t => {
  const previous = globalThis.window;
  let listener;
  const parent = { postMessage: data => queueMicrotask(() => {
    listener({ source: {}, data: { type: 'mathmover:export-support-result', requestId: data.requestId, error: 'foreign frame' } });
    listener({ source: parent, data: { type: 'mathmover:export-support-result', requestId: data.requestId, version: 1 } });
  }) };
  globalThis.window = { parent, addEventListener: (_, fn) => { listener = fn; }, removeEventListener() {} };
  t.after(() => { globalThis.window = previous; });
  assert.equal(await checkExportSupport(), 'host');
});
