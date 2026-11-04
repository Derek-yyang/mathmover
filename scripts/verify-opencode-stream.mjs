import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  opencode, runAgent, createOpenCodeEnvironment, createOpenCodeStatusPlugin,
  buildOpenCodeConfigContent, createTitleExtractor,
} from '../packages/agent-runtime/src/index.ts';

// The real bundled CLI + application plugin/parser; loopback fixture only.
// No BYOK settings, real credentials, daemon or user coursewares are accessed.
process.chdir(fileURLToPath(new URL('../math-mover-next', import.meta.url)));
const root = path.resolve('../spike-out/opencode-stream-verification');
fs.mkdirSync(root, { recursive: true });
const results = [];
const reply = '<mm-title>流式测试</mm-title>第一段回复\n\n**结论**：$x=1$。';
let mode, providerFinished, liveResponse, firstChunkAt;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', async () => {
    const body = JSON.parse(raw);
    // OpenCode may issue background summary/title requests; only the agent
    // request carrying tools belongs to the stream under test.
    const primary = body.tools?.length > 0;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (content, finish_reason = null) => res.write('data: ' + JSON.stringify({
      id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture',
      choices: [{ index: 0, delta: content ? { content } : {}, finish_reason }],
    }) + '\n\n');
    if (!primary) { send('Fixture'); send('', 'stop'); res.end('data: [DONE]\n\n'); return; }
    liveResponse = res;
    firstChunkAt = Date.now();
    const fragments = mode === 'cancel' ? ['保留已生成部分'] : ['<mm-ti', 'tle>流式测试</mm-title>第一段', '回复\n\n', '**结论**：$x=1$。'];
    for (const fragment of fragments) {
      if (res.destroyed) return;
      send(fragment);
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    if (mode === 'cancel') return; // Stop while the upstream response is still open.
    send('', 'stop'); providerFinished = true; res.end('data: [DONE]\n\n');
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (mode of ['complete', 'cancel']) {
    providerFinished = false;
    const directory = path.join(root, mode);
    fs.mkdirSync(directory, { recursive: true });
    const plugin = createOpenCodeStatusPlugin(directory);
    const config = buildOpenCodeConfigContent({ statusPluginUrl: plugin.url, provider: {
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', apiKey: 'fixture-key', apiFormat: 'openai-chat',
    } });
    const events = [], fragments = [], titles = [];
    const extractor = createTitleExtractor();
    let firstTextBeforeEnd = false, firstTextLatency, cancelled = false;
    const receive = event => {
      for (const out of extractor.push(event)) {
        events.push(out);
        if (out.kind === 'title') titles.push(out.title);
        if (out.kind !== 'text-delta' && out.kind !== 'text') continue;
        if (!fragments.length) { firstTextBeforeEnd = !providerFinished; firstTextLatency = Date.now() - firstChunkAt; }
        fragments.push(out.text);
        if (mode === 'cancel' && !cancelled) { cancelled = true; setTimeout(() => handle.cancel(), 0); }
      }
    };
    const handle = runAgent({
      def: opencode, prompt: 'Reply with the requested result.', model: 'fixture', cwd: directory,
      mcpConfigPath: path.join(directory, 'unused.json'),
      env: { ...createOpenCodeEnvironment(path.join(root, 'data')), OPENCODE_CONFIG_CONTENT: config, MATHMOVER_BYOK_API_KEY: 'fixture-key' },
      timeoutMs: 45_000, firstOutputTimeoutMs: 35_000, onEvent: receive,
    });
    try {
      await handle.done;
      for (const event of extractor.flush()) { events.push(event); if (event.kind === 'text-delta') fragments.push(event.text); }
      assert(firstTextBeforeEnd, 'visible text must arrive before upstream completion');
      assert(!events.some(event => event.kind === 'error'), JSON.stringify(events.filter(event => event.kind === 'error')));
      if (mode === 'complete') {
        assert.equal(fragments.join(''), reply.replace(/<mm-title>.*?<\/mm-title>/, ''));
        assert(fragments.length >= 2, 'true multiple fragments, not a single whole-text completion');
        assert.deepEqual(titles, ['流式测试']);
      } else {
        assert.equal(fragments.join(''), '保留已生成部分');
        assert(cancelled);
        assert.equal(providerFinished, false);
      }
      results.push({ mode, firstTextBeforeEnd, firstTextLatency, fragments, titles, kinds: events.map(event => event.kind) });
      console.log(`PASS ${mode}: real CLI streams before completion; no duplication; title/cancellation preserved.`);
    } finally { plugin.cleanup(); liveResponse?.destroy(); }
  }
  fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify(results, null, 2));
} finally { server.closeAllConnections(); server.close(); }
