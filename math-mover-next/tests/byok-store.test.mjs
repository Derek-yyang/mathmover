import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadByokConfig, saveByokConfig, maskByokConfig, isByokRunnable } from '../lib/byok-store.ts';
import { purgeLegacyByokKey } from '../lib/byok-config.ts';
import { sameByokKeyOrigin } from '../lib/byok-key-scope.ts';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'mm-byok-store-'));

test('保存后读回一致；掩码只给尾 4 位，完整 key 不出仓', () => {
  const root = tmp();
  try {
    const view = saveByokConfig(root, { baseUrl: 'http://127.0.0.1:15721/v1', apiKey: 'sk-abcdef123456', model: 'gpt-5.6-luna' });
    assert.deepEqual(view, { apiFormat: 'openai-chat', baseUrl: 'http://127.0.0.1:15721/v1', model: 'gpt-5.6-luna', reasoningLevels: '', apiKeyConfigured: true, apiKeyTail: '3456' });
    assert.ok(!JSON.stringify(view).includes('abcdef'), '掩码视图不含 key 本体');
    assert.equal(loadByokConfig(root).apiKey, 'sk-abcdef123456');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('key 留空仅在同源端点保留，修改路径和模型无需重填', () => {
  const root = tmp();
  try {
    saveByokConfig(root, { baseUrl: 'http://a/v1', apiKey: 'sk-old-key-9999', model: 'm1' });
    const view = saveByokConfig(root, { baseUrl: 'http://a/v2', apiKey: '', model: 'm2' });
    assert.equal(loadByokConfig(root).apiKey, 'sk-old-key-9999');
    assert.equal(view.baseUrl, 'http://a/v2');
    assert.equal(view.model, 'm2');
    assert.equal(view.apiKeyTail, '9999');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('跨源保存不复用旧密钥，拒绝时原配置不变；新密钥或显式无密钥可保存', () => {
  const root = tmp();
  try {
    saveByokConfig(root, { baseUrl: 'https://a.invalid/v1', apiKey: 'fixture-old-key', model: 'm1' });
    const before = readFileSync(path.join(root, 'byok.json'), 'utf8');
    for (const baseUrl of ['https://b.invalid/v1', 'http://a.invalid/v1', 'https://a.invalid:8443/v1', '', 'invalid']) {
      for (const apiKey of ['', '  ', undefined]) {
        assert.throws(() => saveByokConfig(root, { baseUrl, apiKey, model: 'm2' }), /端点已更换/);
        assert.equal(readFileSync(path.join(root, 'byok.json'), 'utf8'), before);
      }
    }
    saveByokConfig(root, { baseUrl: 'https://b.invalid/v1', apiKey: 'fixture-new-key', model: 'm2' });
    assert.equal(loadByokConfig(root).apiKey, 'fixture-new-key');
    const view = saveByokConfig(root, { baseUrl: 'http://127.0.0.1:11434/v1', apiKey: null });
    assert.equal(view.apiKeyConfigured, false);
    assert.equal(loadByokConfig(root).apiKey, '');
    saveByokConfig(root, { baseUrl: 'http://localhost:11434/v1', apiKey: '' });
    assert.equal(loadByokConfig(root).apiKey, '', '无历史密钥时仍允许无密钥端点');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('密钥按协议、域名、端口隔离，URL 规范化和路径变化不影响同源判断', () => {
  for (const url of ['https://EXAMPLE.com/v2/', ' https://example.com:443/other ', 'https://example.com']) {
    assert(sameByokKeyOrigin('https://example.com/v1', url));
  }
  for (const url of ['http://example.com/v1', 'https://example.com:8443/v1', 'https://sub.example.com/v1',
    'https://example.com.attacker.invalid/v1', 'https://user@example.com/v1', 'file:///tmp', 'invalid', '']) {
    assert.equal(sameByokKeyOrigin('https://example.com/v1', url), false);
  }
  assert.equal(sameByokKeyOrigin('', ''), false);
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
  assert.deepEqual(maskByokConfig(null), { apiFormat: 'openai-chat', baseUrl: '', model: '', reasoningLevels: '', apiKeyConfigured: false, apiKeyTail: '' });
});

test('legacy config defaults to Chat Completions; each format persists, partial updates keep it and key masking', () => {
  const root = tmp();
  try {
    writeFileSync(path.join(root, 'byok.json'), JSON.stringify({ baseUrl: 'http://fixture/v1', model: 'm', apiKey: 'fixture-key' }));
    assert.equal(loadByokConfig(root).apiFormat, 'openai-chat');
    for (const apiFormat of ['openai-chat', 'openai-responses', 'anthropic', 'gemini']) {
      const view = saveByokConfig(root, { apiFormat, apiKey: '' });
      assert.equal(view.apiFormat, apiFormat);
      assert.equal(loadByokConfig(root).apiFormat, apiFormat);
      assert.equal(saveByokConfig(root, { model: 'new-model' }).apiFormat, apiFormat);
      assert.equal(loadByokConfig(root).apiKey, 'fixture-key');
      assert(!JSON.stringify(view).includes('fixture-key'));
    }
    const before = readFileSync(path.join(root, 'byok.json'), 'utf8');
    for (const apiFormat of ['unknown', null, '', 123]) {
      assert.throws(() => saveByokConfig(root, { apiFormat }), /接口格式/);
      assert.equal(readFileSync(path.join(root, 'byok.json'), 'utf8'), before, 'invalid formats do not mutate saved config');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
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
