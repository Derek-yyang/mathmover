import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/agent-settings.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const { agentGuide, groupAgents } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const runtimes = [
  { id: 'claude-code', name: 'Claude Code', usable: true, version: 'test-1' },
  { id: 'codex', name: 'Codex', usable: true, version: null },
  { id: 'dsh', name: 'DeepSeek Harness', usable: false, version: null },
];

test('groups by program detection without changing the shared list or selection', () => {
  const before = structuredClone(runtimes);
  const groups = groupAgents(runtimes, 'codex');
  assert.deepEqual(groups.detected.map(item => item.id), ['claude-code', 'codex']);
  assert.deepEqual(groups.unavailable.map(item => item.id), ['dsh']);
  assert.equal(groups.currentUnavailable, undefined);
  assert.deepEqual(runtimes, before);
});
test('unavailable current choice stays prominent, is not duplicated or replaced', () => {
  const groups = groupAgents(runtimes, 'dsh');
  assert.equal(groups.currentUnavailable.id, 'dsh');
  assert.deepEqual(groups.unavailable, []);
  assert.equal(groups.missingSelection, undefined);
});
test('stale selection stays visible even when detection returns no runtimes', () => {
  assert.equal(groupAgents([], 'old-agent').missingSelection, 'old-agent');
  assert.equal(groupAgents(runtimes, 'old-agent').missingSelection, 'old-agent');
  assert.deepEqual(groupAgents([]).detected, []);
});
test('all unavailable runtimes remain discoverable and none are claimed usable', () => {
  const groups = groupAgents(runtimes.map(item => ({ ...item, usable: false })), 'codex');
  assert.deepEqual(groups.detected, []);
  assert.equal(groups.currentUnavailable.id, 'codex');
  assert.deepEqual(groups.unavailable.map(item => item.id), ['claude-code', 'dsh']);
});
test('known agents have official HTTPS guides, unknown IDs never invent documentation', () => {
  const hosts = { 'claude-code': 'code.claude.com', codex: 'developers.openai.com', dsh: 'github.com' };
  for (const [id, host] of Object.entries(hosts)) {
    const guide = agentGuide(id);
    const url = new URL(guide.docsUrl);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, host);
    assert.ok(guide.configure.length > 0);
  }
  for (const id of ['unknown', 'constructor', '__proto__', 'toString']) assert.equal(agentGuide(id), undefined);
});
