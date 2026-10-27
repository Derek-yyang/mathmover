import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { test } from 'node:test';
import ts from 'typescript';
import { saveByokConfig } from '../lib/byok-store.ts';

let source = readFileSync(new URL('../app/api/agent/test/route.ts', import.meta.url), 'utf8');
source = source.replace("import { RUNTIMES, detectRuntimes } from '@mathmover/agent-runtime';", `
  const RUNTIMES = [{ id: 'fixture-cli' }];
  const detectRuntimes = async () => [{ usable: true, authStatus: 'ok', authMessage: 'CLI preflight only', version: 'fixture' }];
`);
for (const [specifier, target] of [
  ['../../../../../packages/daemon/src/data-directory.ts', '../../packages/daemon/src/data-directory.ts'],
  ['@/lib/byok-store', '../lib/byok-store.ts'], ['@/lib/byok-probe', '../lib/byok-probe.ts'],
  ['@/lib/server/same-origin', '../lib/server/same-origin.ts'],
]) source = source.replaceAll(`'${specifier}'`, JSON.stringify(new URL(target, import.meta.url).href));
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { POST } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('test route invokes only the saved configuration over real HTTP, with no writes or secrets in results', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mm-byok-test-'));
  const previous = process.env.MATHMOVER_DATA_DIR;
  process.env.MATHMOVER_DATA_DIR = root;
  const calls = [];
  let mode = 'ok';
  let pendingStarted;
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    calls.push({ url: req.url, method: req.method, headers: req.headers, body: JSON.parse(raw) });
    res.setHeader('content-type', 'application/json');
    if (mode === 'pending') { pendingStarted(); return; }
    if (mode === 'bad-key') {
      res.writeHead(401); res.end(JSON.stringify({ error: { message: 'fixture-saved-secret' } })); return;
    }
    res.end(JSON.stringify(req.url.endsWith('/messages')
      ? { type: 'message', content: [{ type: 'text', text: 'OK' }] }
      : req.url.includes(':generateContent') ? { candidates: [{ content: { parts: [{ text: 'OK' }] } }] }
      : req.url.endsWith('/responses') ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }
      : { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const request = (body = { runtimeId: 'byok' }, origin = 'http://localhost', signal) => new Request('http://localhost/api/agent/test', {
    method: 'POST', headers: { origin }, body: JSON.stringify(body), signal,
  });
  try {
    assert.equal((await (await POST(request())).json()).status, 'unconfigured');
    for (const apiFormat of ['openai-chat', 'openai-responses', 'anthropic', 'gemini']) {
      saveByokConfig(root, { apiFormat, baseUrl, model: 'saved-model', apiKey: 'fixture-saved-secret' });
      const before = readFileSync(path.join(root, 'byok.json'), 'utf8');
      const response = await POST(request({ runtimeId: 'byok', baseUrl: 'https://draft.invalid', model: 'draft-model', apiKey: 'draft-secret' }));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      assert.equal(result.ok, true); assert.match(result.message, /调用成功/);
      assert(!JSON.stringify(result).includes('fixture-saved-secret'));
      const call = calls.at(-1);
      assert.equal(call.method, 'POST'); assert(!call.url.endsWith('/models'));
      assert.equal(call.body.model ?? call.url.split('/models/')[1].split(':')[0], 'saved-model');
      assert.equal(call.headers[apiFormat === 'anthropic' ? 'x-api-key' : apiFormat === 'gemini' ? 'x-goog-api-key' : 'authorization'],
        ['anthropic', 'gemini'].includes(apiFormat) ? 'fixture-saved-secret' : 'Bearer fixture-saved-secret');
      assert(!JSON.stringify(call).includes('draft-'));
      assert.equal(readFileSync(path.join(root, 'byok.json'), 'utf8'), before);
    }
    mode = 'bad-key';
    const failed = await (await POST(request())).json();
    assert.equal(failed.ok, false); assert.equal(failed.status, 'not-logged-in');
    assert(!failed.message.includes('fixture-saved-secret'));
    const count = calls.length;
    assert.equal((await POST(request(undefined, 'https://foreign.invalid'))).status, 403);
    for (const body of [null, [], {}, { runtimeId: 123 }, { runtimeId: 'unknown' }]) assert.equal((await POST(request(body))).status, 400);
    assert.equal((await (await POST(request({ runtimeId: 'fixture-cli' }))).json()).ok, true);
    assert.equal(calls.length, count, 'rejected requests and CLI preflight do not invoke an API model');
    mode = 'pending';
    const started = new Promise(resolve => { pendingStarted = resolve; });
    const controller = new AbortController();
    const pending = POST(request(undefined, undefined, controller.signal));
    await started; controller.abort();
    const cancelled = await (await pending).json();
    assert.equal(cancelled.ok, false); assert.match(cancelled.message, /取消/);
    assert.equal(calls.length, count + 1, 'cancellation does not trigger a retry');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.MATHMOVER_DATA_DIR; else process.env.MATHMOVER_DATA_DIR = previous;
    assert(root.startsWith(path.join(os.tmpdir(), 'mm-byok-test-')));
    rmSync(root, { recursive: true, force: true });
  }
});
