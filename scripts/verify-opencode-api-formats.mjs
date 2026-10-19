import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_FORMATS, opencode, runAgent, resolveRuntimeTarget, buildOpenCodeConfigContent, OPENCODE_BYOK_API_KEY_ENV } from '../packages/agent-runtime/src/index.ts';

// Real bundled OpenCode, loopback model fixtures only. No real keys or daemon calls.
process.chdir(fileURLToPath(new URL('../math-mover-next', import.meta.url)));
assert(resolveRuntimeTarget(opencode), 'bundled OpenCode is installed');
const key = 'fixture-protocol-key', model = 'fixture-model', reply = 'PROTOCOL-OK';
const seen = [];
const response = { id: 'resp_fixture', object: 'response', created_at: 1, model, status: 'in_progress', output: [] };
const item = { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply, annotations: [] }] };
const stream = (data, event) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', part => { raw += part; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    seen.push({ url: req.url, method: req.method, headers: req.headers, body });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (req.url.includes('/chat/completions')) {
      res.end(stream({ id: 'c1', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta: { role: 'assistant', content: reply }, finish_reason: null }] }) +
        stream({ id: 'c1', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n');
    } else if (req.url.includes('/responses')) {
      const events = [
        { type: 'response.created', response },
        { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
        { type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
        { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: reply },
        { type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text: reply },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { ...response, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } },
      ];
      res.end(events.map((event, sequence_number) => stream({ ...event, sequence_number }, event.type)).join(''));
    } else if (req.url.includes('/messages')) {
      const events = [
        { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } },
        { type: 'message_stop' },
      ];
      res.end(events.map(event => stream(event, event.type)).join(''));
    } else if (req.url.includes(':streamGenerateContent')) {
      res.end(stream({ candidates: [{ content: { role: 'model', parts: [{ text: reply }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } }));
    } else res.end('');
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (const format of API_FORMATS) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-api-format-'));
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}/${format.id === 'gemini' ? 'v1beta' : 'v1'}`;
      const config = buildOpenCodeConfigContent({ provider: { baseUrl, apiKey: key, model, apiFormat: format.id } });
      const start = seen.length;
      let text = '';
      const errors = [];
      const handle = runAgent({
        def: opencode, model, prompt: 'Reply with PROTOCOL-OK.', cwd: sandbox,
        mcpConfigPath: path.join(sandbox, 'unused-mcp.json'),
        env: {
          OPENCODE_CONFIG_CONTENT: config,
          [OPENCODE_BYOK_API_KEY_ENV]: key,
          OPENCODE_CONFIG_DIR: sandbox,
          XDG_CONFIG_HOME: sandbox,
          XDG_DATA_HOME: path.join(sandbox, 'data'),
          XDG_CACHE_HOME: path.join(sandbox, 'cache'),
          XDG_STATE_HOME: path.join(sandbox, 'state'),
          OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
          OPENCODE_DISABLE_MODELS_FETCH: 'true',
          OPENCODE_DISABLE_AUTOUPDATE: 'true',
          OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
        },
        inactivityTimeoutMs: 30_000, firstOutputTimeoutMs: 30_000,
        onEvent(event) {
          if (event.kind === 'text' || event.kind === 'text-delta') text += event.text;
          if (event.kind === 'error') errors.push(event.message);
        },
      });
      const { exitCode } = await handle.done;
      const hits = seen.slice(start);
      const expectedPath = { 'openai-chat': '/v1/chat/completions', 'openai-responses': '/v1/responses', anthropic: '/v1/messages', gemini: `/v1beta/models/${model}:streamGenerateContent` }[format.id];
      const hit = hits.find(hit => hit.url.split('?')[0] === expectedPath && hit.body.tools?.length);
      assert(hit, `${format.id}: expected ${expectedPath} with tools, got ${JSON.stringify(hits.map(hit => ({ url: hit.url, keys: Object.keys(hit.body) })))}; ${errors.join('; ')}`);
      assert.equal(hit.method, 'POST');
      if (format.id === 'anthropic') {
        assert.equal(hit.headers['x-api-key'], key);
        assert(hit.headers['anthropic-version']);
        assert(Array.isArray(hit.body.messages));
        assert(hit.body.tools.some(tool => tool.input_schema));
      } else if (format.id === 'gemini') {
        assert.equal(hit.headers['x-goog-api-key'], key);
        assert(Array.isArray(hit.body.contents));
        assert(hit.body.tools.some(tool => tool.functionDeclarations));
      } else {
        assert.equal(hit.headers.authorization, `Bearer ${key}`);
        assert.equal(hit.body.model, model);
        assert(Array.isArray(format.id === 'openai-responses' ? hit.body.input : hit.body.messages));
        assert(hit.body.tools.some(tool => tool.type === 'function'));
      }
      assert.equal(exitCode, 0, errors.join('; '));
      assert.deepEqual(errors, []);
      assert(text.includes(reply), `${format.id}: streamed text parsed, got ${text}`);
      assert(!config.includes(key));
      console.log(`PASS ${format.id}: real OpenCode request path, auth, message/tool serialization and streamed reply.`);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
