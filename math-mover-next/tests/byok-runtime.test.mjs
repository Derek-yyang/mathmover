import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildByokRuntime, sameByokConnection } from '../lib/server/byok-runtime.ts';

const config = { apiFormat: 'openai-chat', baseUrl: 'https://fixture.invalid', apiKey: 'fixture-secret-1234', model: 'private-model', reasoningLevels: 'low,high' };
test('saved metadata reflects configuration readiness without claiming a missing binary is available', () => {
  assert.equal(buildByokRuntime(null, true).authStatus, 'missing');
  const ready = buildByokRuntime(config, true);
  assert.equal(ready.authStatus, 'ok');
  assert.equal(ready.usable, true);
  assert(ready.models.list.some(item => item.id === config.model));
  assert(ready.authMessage.includes('1234'));
  assert(!JSON.stringify(ready).includes(config.apiKey));
  assert.equal(buildByokRuntime(config, false).authStatus, 'missing');
  assert.equal(buildByokRuntime(config, false).usable, false);
  assert.equal(buildByokRuntime({ ...config, baseUrl: '' }, true).authStatus, 'missing');
});
test('metadata applies new effort options and removes obsolete options for unsupported formats', () => {
  const discovered = { source: 'live', list: [{ id: 'listed-model', label: 'Listed', reasoningOptions: [{ id: 'old', label: 'old' }] }] };
  const ready = buildByokRuntime(config, true, discovered);
  assert.equal(ready.models.source, 'live');
  for (const model of ready.models.list) assert.deepEqual(model.reasoningOptions.map(item => item.id), ['low', 'high']);
  const otherFormat = buildByokRuntime({ ...config, apiFormat: 'gemini' }, true, discovered);
  for (const model of otherFormat.models.list) assert.equal(model.reasoningOptions, undefined);
  assert(sameByokConnection(config, { ...config, model: 'other', reasoningLevels: 'medium' }));
  for (const patch of [{ apiKey: 'other' }, { baseUrl: 'https://other.invalid' }, { apiFormat: 'gemini' }]) {
    assert(!sameByokConnection(config, { ...config, ...patch }));
  }
});
