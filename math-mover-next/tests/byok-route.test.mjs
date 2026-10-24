import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { readCachedRuntime, readFreshDetectionCache, writeDetectionCache, invalidateDetectionCache } from '../lib/server/detection-cache.ts';

// Run the actual route handlers with only import resolution adapted for Node.
let source = readFileSync(new URL('../app/api/byok/route.ts', import.meta.url), 'utf8');
for (const [specifier, target] of [
  ['../../../../packages/daemon/src/data-directory.ts', '../../packages/daemon/src/data-directory.ts'],
  ['@/lib/byok-store', '../lib/byok-store.ts'],
  ['@/lib/server/detection-cache', '../lib/server/detection-cache.ts'],
  ['@/lib/server/byok-runtime', '../lib/server/byok-runtime.ts'],
  ['@/lib/server/same-origin', '../lib/server/same-origin.ts'],
  ['../../../../packages/agent-runtime/src/api-format.ts', '../../packages/agent-runtime/src/api-format.ts'],
]) source = source.replaceAll(`'${specifier}'`, JSON.stringify(new URL(target, import.meta.url).href));
// Availability is a local executable lookup, not a CLI/authentication probe.
source = source.replace("import { opencode, resolveRuntimeTarget } from '@mathmover/agent-runtime';", "const opencode = {}; const resolveRuntimeTarget = () => 'fixture-binary';");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { GET, POST } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const request = body => new Request('http://localhost/api/byok', { method: 'POST', body: JSON.stringify(body) });

test('API persists each format, masks credentials and rejects invalid requests without changing saved data', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mm-byok-route-'));
  const previous = process.env.MATHMOVER_DATA_DIR;
  process.env.MATHMOVER_DATA_DIR = root;
  try {
    const initial = await GET(new Request('http://localhost/api/byok'));
    assert.equal((await initial.json()).apiFormat, 'openai-chat');
    for (const apiFormat of ['openai-chat', 'openai-responses', 'anthropic', 'gemini']) {
      const saved = await POST(request({ apiFormat, baseUrl: ' https://fixture.invalid/v1 ', model: 'fixture', apiKey: 'fixture-secret-1234' }));
      assert.equal(saved.status, 200);
      const { runtime, ...view } = await saved.json();
      assert.equal(runtime.authStatus, 'ok', 'first save immediately marks the configured built-in Agent ready');
      assert(runtime.models.list.some(item => item.id === 'fixture'));
      assert(!JSON.stringify(runtime).includes('fixture-secret'));
      assert.equal(view.apiFormat, apiFormat);
      assert.equal(view.baseUrl, 'https://fixture.invalid/v1');
      assert.equal(view.apiKeyTail, '1234');
      assert(!JSON.stringify(view).includes('fixture-secret'));
      const read = await GET(new Request('http://localhost/api/byok'));
      assert.deepEqual(await read.json(), view);
    }
    const file = path.join(root, 'byok.json');
    const before = readFileSync(file, 'utf8');
    for (const body of [null, [], 'invalid', { apiFormat: 'unsupported' }, { apiFormat: null }, { apiFormat: '' }]) {
      assert.equal((await POST(request(body))).status, 400);
      assert.equal(readFileSync(file, 'utf8'), before);
    }
    const foreign = new Request('http://localhost/api/byok', { method: 'POST', headers: { origin: 'https://other.invalid' }, body: '{}' });
    assert.equal((await POST(foreign)).status, 403);
    const partial = await POST(request({ model: 'updated' }));
    assert.equal((await partial.json()).apiFormat, 'gemini', 'old clients preserve the stored format');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).apiKey, 'fixture-secret-1234');
  } finally {
    if (previous === undefined) delete process.env.MATHMOVER_DATA_DIR;
    else process.env.MATHMOVER_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test('save updates only built-in metadata and reuses models only for the same connection', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mm-byok-save-sync-'));
  const previous = process.env.MATHMOVER_DATA_DIR;
  process.env.MATHMOVER_DATA_DIR = root;
  try {
    const input = { apiFormat: 'openai-chat', baseUrl: 'https://fixture.invalid/v1', model: 'a', apiKey: 'fixture-secret', reasoningLevels: 'low,high' };
    await POST(request(input));
    const thirdParty = { id: 'codex', name: 'Codex', version: null, usable: true };
    writeDetectionCache([thirdParty, {
      id: 'byok', name: '内置Agent', version: null, usable: true,
      models: { source: 'live', list: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }] },
    }]);
    const saved = await (await POST(request({ reasoningLevels: 'medium,high' }))).json();
    assert.equal(saved.runtime.models.source, 'live');
    assert.deepEqual(saved.runtime.models.list.map(item => item.id), ['a', 'b']);
    assert.deepEqual(saved.runtime.models.list[0].reasoningOptions.map(item => item.id), ['medium', 'high']);
    assert.deepEqual(readCachedRuntime('byok'), saved.runtime);
    assert.deepEqual(readCachedRuntime('codex'), thirdParty);
    // Repeated saves retain the discovered catalog, and do not extend its TTL.
    const changed = await (await POST(request({ model: 'private-model' }))).json();
    assert(changed.runtime.models.list.some(item => item.id === 'b'));
    assert(changed.runtime.models.list.some(item => item.id === 'private-model'));
    assert.equal(readFreshDetectionCache(Date.now() + 61_000), null);
    const newConnection = await (await POST(request({ baseUrl: 'https://new.fixture.invalid/v1' }))).json();
    assert.equal(newConnection.runtime.models.source, 'fallback');
    assert(!newConnection.runtime.models.list.some(item => item.id === 'b'), 'do not reuse another endpoint catalog');
    assert(!JSON.stringify(newConnection).includes(input.apiKey));
  } finally {
    invalidateDetectionCache();
    if (previous === undefined) delete process.env.MATHMOVER_DATA_DIR;
    else process.env.MATHMOVER_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
