import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchByokModels, probeByokConfig } from '../lib/byok-probe.ts';

const config = { apiFormat: 'openai-chat', baseUrl: 'https://fixture.invalid/v1/', model: 'saved-model', apiKey: 'fixture-secret-key', reasoningLevels: '' };
const replies = {
  'openai-chat': { choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] },
  'openai-responses': { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] },
  anthropic: { type: 'message', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' },
  gemini: { candidates: [{ content: { parts: [{ text: 'OK' }] }, finishReason: 'STOP' }] },
};
const suffixes = { 'openai-chat': 'chat/completions', 'openai-responses': 'responses', anthropic: 'messages', gemini: 'models/saved-model:generateContent' };

for (const apiFormat of Object.keys(replies)) {
  test(`${apiFormat}: one invocation uses the saved model and protocol, never discovery or retries`, async () => {
    let calls = 0;
    const before = { ...config, apiFormat };
    const result = await probeByokConfig(before, async (url, init) => {
      calls++;
      assert.equal(url, `https://fixture.invalid/v1/${suffixes[apiFormat]}`);
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
      assert.equal(init.headers['content-type'], 'application/json');
      const auth = apiFormat === 'anthropic' ? 'x-api-key' : apiFormat === 'gemini' ? 'x-goog-api-key' : 'authorization';
      assert.equal(init.headers[auth], auth === 'authorization' ? `Bearer ${config.apiKey}` : config.apiKey);
      if (apiFormat === 'anthropic') assert.equal(init.headers['anthropic-version'], '2023-06-01');
      const body = JSON.parse(init.body);
      if (apiFormat === 'gemini') {
        assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'Reply with exactly OK.' }] }]);
        assert.equal(body.generationConfig.maxOutputTokens, 128);
      } else {
        assert.equal(body.model, config.model);
        if (apiFormat === 'openai-responses') {
          assert.equal(body.input, 'Reply with exactly OK.'); assert.equal(body.max_output_tokens, 128);
        } else {
          assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply with exactly OK.' }]); assert.equal(body.max_tokens, 128);
        }
      }
      assert.equal(body.tools, undefined); assert.equal(body.reasoning_effort, undefined);
      return Response.json(replies[apiFormat]);
    });
    assert.equal(calls, 1); assert.equal(result.ok, true); assert.equal(result.status, 'ready');
    assert.match(result.message, /调用成功/); assert.match(result.message, /未验证工具调用/);
    assert(!JSON.stringify(result).includes(config.apiKey));
    assert.deepEqual(before, { ...config, apiFormat });
    await probeByokConfig({ ...config, apiFormat, apiKey: '' }, async (_, init) => {
      assert(!('authorization' in init.headers)); assert(!('x-api-key' in init.headers)); assert(!('x-goog-api-key' in init.headers));
      return Response.json(replies[apiFormat]);
    });
    for (const data of [null, {}, { data: [{ id: 'saved-model' }] }, { content: 'OK' }]) {
      assert.equal((await probeByokConfig({ ...config, apiFormat }, async () => Response.json(data))).ok, false);
    }
    assert.equal((await probeByokConfig({ ...config, apiFormat }, async () => new Response('<html>login</html>'))).status, 'unverified');
  });
}

test('a public model list proves neither authorization, balance nor model access', async () => {
  for (const [status, state, message] of [[401, 'not-logged-in', /密钥/], [402, 'broken', /余额或配额/], [403, 'not-logged-in', /权限/],
    [429, 'broken', /限流/], [404, 'unverified', /模型或调用地址/], [400, 'unverified', /接口格式/], [503, 'broken', /HTTP 503/]]) {
    const calls = [];
    const request = async (url, init) => {
      calls.push({ url, method: init.method });
      return url.endsWith('/models') ? Response.json({ data: [{ id: config.model }] })
        : Response.json({ error: { message: config.apiKey } }, { status });
    };
    assert.equal((await fetchByokModels(config, request)).ok, true);
    const result = await probeByokConfig(config, request);
    assert.equal(result.ok, false); assert.equal(result.status, state); assert.match(result.message, message);
    assert.equal(calls.length, 2, 'one discovery plus one invocation; no fallback or retry');
    assert(!JSON.stringify(result).includes(config.apiKey));
  }
  for (const status of [200, 429, 500]) {
    const result = await probeByokConfig(config, async () => Response.json({ error: { code: 'insufficient_quota', message: `Upstream request failed: Insufficient account funds ${config.apiKey}` } }, { status }));
    assert.equal(result.ok, false); assert.match(result.message, /余额或配额/); assert(!result.message.includes(config.apiKey));
  }
});

test('token-limited reasoning replies prove invocation without claiming completed text', async () => {
  const limited = {
    'openai-chat': { choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { completion_tokens: 128 } },
    'openai-responses': { status: 'incomplete', output: [], incomplete_details: { reason: 'max_output_tokens' }, usage: { output_tokens: 128 } },
    anthropic: { type: 'message', content: [], stop_reason: 'max_tokens', usage: { output_tokens: 128 } },
    gemini: { candidates: [{ finishReason: 'MAX_TOKENS' }], usageMetadata: { thoughtsTokenCount: 128 } },
  };
  for (const [apiFormat, data] of Object.entries(limited)) {
    const result = await probeByokConfig({ ...config, apiFormat }, async () => Response.json(data));
    assert.equal(result.ok, true); assert.match(result.message, /输出达到长度上限/);
    const empty = structuredClone(data);
    delete empty.usage; delete empty.usageMetadata;
    assert.equal((await probeByokConfig({ ...config, apiFormat }, async () => Response.json(empty))).ok, false);
  }
  assert.equal((await probeByokConfig({ ...config, apiFormat: 'openai-responses' }, async () => Response.json({ ...replies['openai-responses'], status: 'failed' }))).ok, false);
  assert.equal((await probeByokConfig({ ...config, apiFormat: 'gemini' }, async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }))).ok, false);
});

test('OpenCode invocation keeps its inference prefix; Gemini model IDs are safe URL segments', async () => {
  for (const apiFormat of ['openai-chat', 'openai-responses']) {
    await probeByokConfig({ ...config, apiFormat, baseUrl: 'https://opencode.ai/inference/openai/v1///' }, async (url) => {
      assert.equal(url, `https://opencode.ai/inference/openai/v1/${suffixes[apiFormat]}`);
      return Response.json(replies[apiFormat]);
    });
  }
  await probeByokConfig({ ...config, apiFormat: 'gemini', model: 'models/vendor/model?key=bad' }, async url => {
    assert.equal(url, 'https://fixture.invalid/v1/models/vendor%2Fmodel%3Fkey%3Dbad:generateContent');
    return Response.json(replies.gemini);
  });
});

test('OpenAI reasoning models use the supported Chat Completions token field in one request', async () => {
  for (const model of ['gpt-5', 'gpt-5.4-nano', 'o3', 'o4-mini']) {
    let calls = 0;
    const result = await probeByokConfig({ ...config, model }, async (_, init) => {
      calls++;
      const body = JSON.parse(init.body);
      assert.equal(body.max_completion_tokens, 128); assert.equal(body.max_tokens, undefined);
      return Response.json(replies['openai-chat']);
    });
    assert.equal(result.ok, true); assert.equal(calls, 1);
  }
});

test('cancellation, timeout and network errors never retry or echo credentials', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = probeByokConfig(config, (_, init) => {
    calls++;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error(config.apiKey)), { once: true }));
  }, { signal: controller.signal });
  controller.abort();
  const cancelled = await pending;
  assert.match(cancelled.message, /取消/); assert.equal(cancelled.ok, false); assert.equal(calls, 1);
  const already = await probeByokConfig(config, async () => { throw new Error('must not send'); }, { signal: controller.signal });
  assert.match(already.message, /取消/);
  const failed = await probeByokConfig(config, async () => { throw new Error(config.apiKey); });
  assert.match(failed.message, /地址与网络/); assert(!failed.message.includes(config.apiKey));
  const original = AbortSignal.timeout;
  const timer = new AbortController();
  AbortSignal.timeout = () => timer.signal;
  try {
    const pendingTimeout = probeByokConfig(config, (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })));
    timer.abort(new DOMException('fixture-secret-key', 'TimeoutError'));
    assert.match((await pendingTimeout).message, /超时/);
  } finally { AbortSignal.timeout = original; }
  for (const baseUrl of ['file:///tmp', 'https://fixture.invalid/v1?key=secret', 'https://user:secret@fixture.invalid/v1']) {
    const invalid = await probeByokConfig({ ...config, baseUrl }, async () => { assert.fail('invalid URLs cannot send credentials'); });
    assert.equal(invalid.status, 'unverified');
  }
});
