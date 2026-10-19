import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probeByokConfig } from '../lib/byok-probe.ts';

for (const apiFormat of ['openai-chat', 'openai-responses', 'anthropic', 'gemini']) {
  test(`${apiFormat}: model-list request uses the saved format's authentication, without generation`, async () => {
    const config = { apiFormat, baseUrl: 'https://fixture.invalid/version/', model: 'fixture-model', apiKey: 'fixture-key' };
    let calls = 0;
    const result = await probeByokConfig(config, async (url, init) => {
      calls++;
      assert.equal(url, 'https://fixture.invalid/version/models');
      assert.equal(init.method, undefined, 'GET only, never a billed generation');
      assert.equal(init.body, undefined);
      const expected = apiFormat === 'anthropic'
        ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }
        : apiFormat === 'gemini' ? { 'x-goog-api-key': config.apiKey } : { authorization: `Bearer ${config.apiKey}` };
      assert.deepEqual(init.headers, expected);
      return Response.json(apiFormat === 'gemini' ? { models: [] } : { data: [] });
    });
    assert.equal(calls, 1); assert.equal(result.ok, true);
    assert.match(result.message, /生成与工具调用能力以实际使用为准/);
    assert(!JSON.stringify(result).includes(config.apiKey));
    for (const status of [401, 403, 404, 405, 500]) {
      const failed = await probeByokConfig(config, async () => new Response('', { status }));
      assert.equal(failed.ok, false);
      assert.equal(failed.status, [401, 403].includes(status) ? 'not-logged-in' : [404, 405].includes(status) ? 'unverified' : 'broken');
    }
    assert.equal((await probeByokConfig(config, async () => new Response('<html>proxy</html>'))).status, 'unverified');
    assert.equal((await probeByokConfig(config, async () => Response.json({ wrong: [] }))).ok, false);
    assert.equal((await probeByokConfig(config, async () => { throw new Error('fixture'); })).status, 'broken');
    await probeByokConfig({ ...config, apiKey: '' }, async (_, init) => {
      assert(!Object.values(init.headers).some(value => value === '' || value.includes('Bearer')));
      return Response.json(apiFormat === 'gemini' ? { models: [] } : { data: [] });
    });
  });
}
