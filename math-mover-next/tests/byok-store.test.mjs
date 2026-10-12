import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/byok-store.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const { loadByokConfig, saveByokConfig, maskByokConfig, isByokRunnable } =
  await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const cfgSource = readFileSync(new URL('../lib/byok-config.ts', import.meta.url), 'utf8');
const cfgCode = ts.transpileModule(cfgSource, { compilerOptions: { module: ts.ModuleKind.ES2020 } }).outputText;
const { purgeLegacyByokKey } =
  await import('data:text/javascript;base64,' + Buffer.from(cfgCode).toString('base64'));

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'mm-byok-store-'));

test('保存后读回一致；掩码只给尾 4 位，完整 key 不出仓', () => {
  const root = tmp();
  try {
    const view = saveByokConfig(root, { baseUrl: 'http://127.0.0.1:15721/v1', apiKey: 'sk-abcdef123456', model: 'gpt-5.6-luna' });
    assert.deepEqual(view, { baseUrl: 'http://127.0.0.1:15721/v1', model: 'gpt-5.6-luna', apiKeyConfigured: true, apiKeyTail: '3456' });
    assert.ok(!JSON.stringify(view).includes('abcdef'), '掩码视图不含 key 本体');
    assert.equal(loadByokConfig(root).apiKey, 'sk-abcdef123456');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('key 留空 = 保留原 key（改端点/模型不必重填）', () => {
  const root = tmp();
  try {
    saveByokConfig(root, { baseUrl: 'http://a/v1', apiKey: 'sk-old-key-9999', model: 'm1' });
    const view = saveByokConfig(root, { baseUrl: 'http://b/v1', apiKey: '', model: 'm2' });
    assert.equal(loadByokConfig(root).apiKey, 'sk-old-key-9999');
    assert.equal(view.baseUrl, 'http://b/v1');
    assert.equal(view.model, 'm2');
    assert.equal(view.apiKeyTail, '9999');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('apiKey: null = 清除密钥（三态语义）', () => {
  const root = tmp();
  try {
    saveByokConfig(root, { baseUrl: 'http://a/v1', apiKey: 'sk-gone-4242', model: 'm' });
    const view = saveByokConfig(root, { baseUrl: 'http://a/v1', apiKey: null, model: 'm' });
    assert.equal(view.apiKeyConfigured, false);
    assert.equal(loadByokConfig(root).apiKey, '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('掩码与可跑判定：缺端点或模型不可跑；本地端点无 key 仍可跑', () => {
  assert.equal(isByokRunnable(loadByokConfig(tmp())), false);
  assert.equal(isByokRunnable({ baseUrl: 'http://x/v1', apiKey: '', model: 'm' }), true);
  assert.equal(isByokRunnable({ baseUrl: 'ftp://x', apiKey: '', model: 'm' }), false);
  assert.deepEqual(maskByokConfig(null), { baseUrl: '', model: '', apiKeyConfigured: false, apiKeyTail: '' });
});

test('purgeLegacyByokKey 清掉 localStorage 时代的 mm.byok 残键（可能含 key 本体）', () => {
  const removed = [];
  globalThis.localStorage = { removeItem: (k) => removed.push(k) };
  purgeLegacyByokKey();
  assert.deepEqual(removed, ['mm.byok']);
  delete globalThis.localStorage;
});

test('purgeLegacyByokKey 在 localStorage 不可读时静默跳过', () => {
  delete globalThis.localStorage;
  assert.doesNotThrow(() => purgeLegacyByokKey());
});
