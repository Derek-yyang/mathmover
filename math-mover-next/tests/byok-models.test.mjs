import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { test } from 'node:test';
import ts from 'typescript';
import { fetchByokModels, probeByokConfig } from '../lib/byok-probe.ts';
import { saveByokConfig } from '../lib/byok-store.ts';

let source = readFileSync(new URL('../app/api/byok/models/route.ts', import.meta.url), 'utf8');
for (const [specifier, target] of [
  ['../../../../../packages/daemon/src/data-directory.ts', '../../packages/daemon/src/data-directory.ts'],
  ['../../../../../packages/agent-runtime/src/api-format.ts', '../../packages/agent-runtime/src/api-format.ts'],
  ['@/lib/byok-store', '../lib/byok-store.ts'], ['@/lib/byok-probe', '../lib/byok-probe.ts'],
  ['@/lib/server/same-origin', '../lib/server/same-origin.ts'],
]) source = source.replaceAll(`'${specifier}'`, JSON.stringify(new URL(target, import.meta.url).href));
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { POST } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

test('draft discovery uses real HTTP with protocol auth, saved/new keys and no config writes', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mm-byok-models-'));
  const previous = process.env.MATHMOVER_DATA_DIR;
  process.env.MATHMOVER_DATA_DIR = root;
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push({ url: req.url, method: req.method, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/bad/')) { res.writeHead(401); res.end(JSON.stringify({ error: 'fixture-secret-never-echo' })); return; }
    res.end(JSON.stringify(req.headers['x-goog-api-key']
      ? { models: [{ name: 'models/gemini-fixture', displayName: 'Gemini Fixture' }] }
      : { data: [{ id: 'fixture-model', display_name: 'Fixture Model' }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (body, origin) => new Request('http://localhost/api/byok/models', {
    method: 'POST', headers: origin ? { origin } : {}, body: JSON.stringify(body),
  });
  try {
    saveByokConfig(root, { baseUrl: 'https://saved.invalid/v1', model: 'saved-model', apiKey: 'fixture-saved-key' });
    const before = readFileSync(path.join(root, 'byok.json'), 'utf8');
    for (const apiFormat of ['openai-chat', 'openai-responses', 'anthropic', 'gemini']) {
      const response = await POST(request({ apiFormat, baseUrl: `${base}/v1/`, apiKey: '' }, 'http://localhost'));
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      assert.equal(result.ok, true);
      assert.deepEqual(result.models, apiFormat === 'gemini'
        ? [{ id: 'gemini-fixture', label: 'Gemini Fixture' }] : [{ id: 'fixture-model', label: 'Fixture Model' }]);
      assert(!JSON.stringify(result).includes('fixture-saved-key'));
      const call = calls.at(-1);
      assert.equal(call.url, '/v1/models'); assert.equal(call.method, 'GET');
      assert.equal(call.headers[apiFormat === 'anthropic' ? 'x-api-key' : apiFormat === 'gemini' ? 'x-goog-api-key' : 'authorization'],
        ['anthropic', 'gemini'].includes(apiFormat) ? 'fixture-saved-key' : 'Bearer fixture-saved-key');
    }
    await POST(request({ apiFormat: 'openai-chat', baseUrl: `${base}/v1`, apiKey: 'fixture-new-key' }));
    assert.equal(calls.at(-1).headers.authorization, 'Bearer fixture-new-key');
    const failed = await POST(request({ apiFormat: 'openai-chat', baseUrl: `${base}/bad` }));
    assert.equal((await failed.json()).ok, false);
    const count = calls.length;
    for (const body of [null, [], {}, { apiFormat: 'unknown', baseUrl: base }, { apiFormat: 'gemini', baseUrl: 'file:///tmp' },
      { apiFormat: 'gemini', baseUrl: base, apiKey: 123 }, { apiFormat: 'gemini', baseUrl: `${base}?key=secret` }]) {
      assert.equal((await POST(request(body))).status, 400);
    }
    assert.equal((await POST(request({ apiFormat: 'gemini', baseUrl: base }, 'https://foreign.invalid'))).status, 403);
    assert.equal(calls.length, count);
    assert.equal(readFileSync(path.join(root, 'byok.json'), 'utf8'), before, 'discovery never saves draft fields or keys');
    rmSync(path.join(root, 'byok.json'));
    assert.equal((await (await POST(request({ apiFormat: 'openai-chat', baseUrl: `${base}/v1`, apiKey: 'first-key' }))).json()).ok, true,
      'first-time setup needs neither a saved configuration nor a model');
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.MATHMOVER_DATA_DIR; else process.env.MATHMOVER_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

for (const apiFormat of ['anthropic', 'gemini']) test(`${apiFormat}: pagination, IDs, deduplication, malformed pages and cancellation`, async () => {
  const config = { apiFormat, baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-key', model: 'unused' };
  const urls = [];
  const fixture = async (url, init) => {
    urls.push(url); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    const page2 = urls.length === 2;
    return Response.json(apiFormat === 'gemini'
      ? { models: [{ name: 'models/first', displayName: 'First' }, ...(page2 ? [{ name: 'models/second' }, { name: '' }] : [])], ...(!page2 ? { nextPageToken: 'next/token' } : {}) }
      : { data: [{ id: 'first', display_name: 'First' }, ...(page2 ? [{ id: 'second' }, null, { id: 123 }] : [])], has_more: !page2, last_id: 'first' });
  };
  const result = await fetchByokModels(config, fixture);
  assert.deepEqual(result.models, [{ id: 'first', label: 'First' }, { id: 'second', label: 'second' }]);
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]).searchParams.get(apiFormat === 'gemini' ? 'pageToken' : 'after_id'), apiFormat === 'gemini' ? 'next/token' : 'first');
  urls.length = 0;
  assert.equal((await probeByokConfig(config, fixture)).ok, true);
  assert.equal(urls.length, 1, 'connection test reads only one page');
  const broken = await fetchByokModels(config, async () => Response.json(apiFormat === 'gemini'
    ? { models: [], nextPageToken: 'repeat' } : { data: [], has_more: true, last_id: 'repeat' }));
  assert.equal(broken.ok, false); assert.match(broken.message, /分页/);
  const controller = new AbortController();
  const pending = fetchByokModels(config, (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('fixture-key')), { once: true })), { signal: controller.signal });
  controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.ok, false); assert(!JSON.stringify(cancelled).includes('fixture-key'));
});
