import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/routing-settings.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const { readRoutingConfig, routingChanges, routingSavePayload, routingValidation } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const cfg = readRoutingConfig({ base_url: 'https://example.com/v1', model_name: 'router-model', api_key_masked: '****abcd', router_mode: 'llm', decisions_threshold: 0.8, decisions_model: 'saved-decider', perplexity_api_key_masked: '****efgh', max_tokens: 128000 });

test('failed or malformed loads cannot construct a writable empty configuration', () => {
  for (const data of [null, [], {}, { error: 'offline' }, { ok: false }]) assert.throws(() => readRoutingConfig(data));
  assert.deepEqual(routingChanges(null, cfg, 'new-key'), {});
  assert.deepEqual(routingChanges(cfg, null, 'new-key'), {});
});
test('unchanged configuration and whitespace-only secrets produce no writes', () => {
  assert.deepEqual(routingChanges(cfg, { ...cfg, base_url: '  ' + cfg.base_url + '  ' }, '  ', '  '), {});
});
test('only changed fields are posted; saved secrets, provider and output limits are untouched', () => {
  assert.deepEqual(routingChanges(cfg, { ...cfg, model_name: 'new-router' }), { model_name: 'new-router' });
  assert.deepEqual(routingChanges(cfg, { ...cfg, router_mode: 'decisions' }), { router_mode: 'decisions' });
});
test('explicit new secrets are trimmed, never echoed from masked fields', () => {
  assert.deepEqual(routingChanges(cfg, cfg, ' new-key ', ' new-decisions-key '), { api_key: 'new-key', perplexity_api_key: 'new-decisions-key' });
  const loaded = readRoutingConfig({ ...cfg, api_key: 'not-for-the-ui' });
  assert.equal('api_key' in loaded, false);
});
test('save payload carries the existing decision model because the legacy endpoint resets omitted IDs', () => {
  assert.deepEqual(routingSavePayload(cfg, { ...cfg, model_name: 'new-router' }), { model_name: 'new-router', decisions_model: 'saved-decider' });
  assert.deepEqual(routingSavePayload(cfg, cfg), {});
  assert.deepEqual(routingSavePayload(null, cfg, 'key'), {});
});
test('validates endpoints, fallback model and required keys', () => {
  assert.equal(routingValidation(cfg), null);
  for (const base_url of ['', 'invalid', 'file:///tmp/a', 'https://user:pass@example.com']) assert.ok(routingValidation({ ...cfg, base_url }));
  assert.ok(routingValidation({ ...cfg, model_name: '' }));
  assert.ok(routingValidation({ ...cfg, api_key_masked: '' }));
  assert.equal(routingValidation({ ...cfg, api_key_masked: '' }, 'new-key'), null);
});
test('decision mode requires a valid probability and LLM fallback; hidden settings persist', () => {
  const decisions = { ...cfg, router_mode: 'decisions' };
  for (const decisions_threshold of ['0', '1.1', '-0.5', 'NaN', '']) assert.ok(routingValidation({ ...decisions, decisions_threshold }));
  for (const decisions_threshold of ['0.001', '0.8', '1']) assert.equal(routingValidation({ ...decisions, decisions_threshold }), null);
  assert.ok(routingValidation({ ...decisions, perplexity_api_key_masked: '' }));
  assert.ok(routingValidation({ ...decisions, model_name: '' }));
  assert.deepEqual(routingChanges(decisions, { ...decisions, router_mode: 'llm' }), { router_mode: 'llm' });
});
