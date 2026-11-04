import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { opencode, runAgent, resolveRuntimeTarget, spawnCapture, assertOpenCodeWorkspaceIsolated, createOpenCodeEnvironment, openCodePaths,
  buildOpenCodeConfigContent, createOpenCodeStatusPlugin, OPENCODE_BYOK_API_KEY_ENV } from '../packages/agent-runtime/src/index.ts';
import { prepareOpenCodeSession } from '../math-mover-next/lib/server/opencode-session.ts';

// Real pinned binary and real MathMover MCP, with loopback model/daemon fixtures only.
// No user config, keys, courseware records or external API calls are modified.
const repository = fileURLToPath(new URL('..', import.meta.url));
process.chdir(path.join(repository, 'math-mover-next'));
const target = resolveRuntimeTarget(opencode);
assert(target, 'bundled binary must exist');
const artifacts = path.join(repository, 'spike-out', 'opencode-isolation');
fs.mkdirSync(artifacts, { recursive: true });
const root = fs.mkdtempSync(path.join(artifacts, 'run-'));
const courseware = path.join(root, 'workspaces', 'courseware-a');
const foreign = path.join(root, 'foreign-home');
const sentinel = path.join(root, 'foreign-loaded');
const model = 'fixture-model', apiKey = 'fixture-key', token = 'a'.repeat(64);
const requests = [], daemonRequests = [];
const globalFile = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
const digest = file => fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const globalBefore = digest(globalFile);
fs.mkdirSync(courseware, { recursive: true });
fs.mkdirSync(foreign, { recursive: true });
const foreignPlugin = path.join(foreign, 'plugin.mjs');
fs.writeFileSync(foreignPlugin, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(sentinel)}, 'foreign plugin loaded'); export default async()=>({});`);
const foreignConfig = { mcp: { syslab: { type: 'local', command: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(sentinel)},'mcp')`], enabled: true } }, plugin: [new URL('file:///' + foreignPlugin.replaceAll('\\', '/')).href] };
const foreignFile = path.join(foreign, 'opencode.json');
fs.writeFileSync(foreignFile, JSON.stringify(foreignConfig));
fs.writeFileSync(path.join(courseware, 'opencode.json'), JSON.stringify(foreignConfig));
assert.throws(() => assertOpenCodeWorkspaceIsolated(courseware), /已停止启动以保持隔离/);
assert.equal(digest(path.join(courseware, 'opencode.json')), digest(foreignFile));
// This is our test fixture, not a real courseware directory. Move the injected
// config out of the discovery path after verifying the pre-launch guard.
fs.renameSync(path.join(courseware, 'opencode.json'), path.join(foreign, 'blocked-project-config.json'));
fs.writeFileSync(path.join(root, 'opencode.jsonc'), JSON.stringify(foreignConfig));
assert.throws(() => assertOpenCodeWorkspaceIsolated(courseware), /已停止启动以保持隔离/);
fs.renameSync(path.join(root, 'opencode.jsonc'), path.join(foreign, 'blocked-ancestor-config.jsonc'));
fs.writeFileSync(path.join(courseware, 'AGENTS.md'), 'FOREIGN_PROJECT_INSTRUCTION_MARKER');
for (const directory of ['.claude/skills/foreign-skill', '.agents/skills/foreign-skill']) {
  const skill = path.join(foreign, directory); fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: foreign-skill\ndescription: FOREIGN_SKILL_MARKER\n---\nForeign instructions');
}
let retryPending = true;
const chunk = (delta, finish_reason = null) => 'data: ' + JSON.stringify({ id: 'fixture-' + requests.length, object: 'chat.completion.chunk', created: 0, model,
  choices: [{ index: 0, delta, finish_reason }] }) + '\n\n';
const server = http.createServer(async (req, res) => {
  const pieces = []; for await (const piece of req) pieces.push(piece);
  const body = JSON.parse(Buffer.concat(pieces).toString() || '{}');
  requests.push({ url: req.url, body, authorization: req.headers.authorization, at: performance.now() });
  if (requests.length > 8) { res.writeHead(400); res.end(JSON.stringify({ error: { message: 'fixture exceeded expected model rounds' } })); return; }
  if (retryPending) { retryPending = false; res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' }); res.end(JSON.stringify({ error: { message: 'fixture temporary rate limit' } })); return; }
  const text = JSON.stringify(body.messages);
  const results = body.messages.filter(message => message.role === 'tool');
  let delta, finish;
  if (!results.length) {
    delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'call-expert', type: 'function', function: { name: 'mathmover_get_expert_prompt', arguments: '{"category":"A"}' } }] }; finish = 'tool_calls';
  } else if (!text.includes('ISOLATED_BOARD_MARKER')) {
    delta = { role: 'assistant', tool_calls: [{ index: 0, id: 'call-board', type: 'function', function: { name: 'mathmover_ggb_get_state', arguments: '{"png":false}' } }] }; finish = 'tool_calls';
  } else {
    delta = { role: 'assistant', content: '<mm-title>隔离测试</mm-title>ISOLATION-OK' }; finish = 'stop';
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(chunk(delta) + chunk({}, finish) + 'data: [DONE]\n\n');
});
const daemon = http.createServer((req, res) => {
  daemonRequests.push({ path: req.url, token: req.headers['x-mathmover-token'], window: req.headers['x-mathmover-window'], courseware: req.headers['x-mathmover-courseware'] });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ generation: 1, mode: '2D', commands: [], objects: [{ name: 'ISOLATED_BOARD_MARKER', type: 'point', independent: true, value: '(1,2)' }], sliders: [], audit: { findings: [] }, png: { base64: null, source: null, width: null, height: null }, degraded: false, degradedReasons: [] }));
});
await Promise.all([new Promise(resolve => server.listen(0, '127.0.0.1', resolve)), new Promise(resolve => daemon.listen(0, '127.0.0.1', resolve))]);
const inherited = { ...process.env, HOME: foreign, USERPROFILE: foreign, OPENCODE_CONFIG: foreignFile,
  OPENCODE_AUTH_CONTENT: JSON.stringify({ foreign: { type: 'api', key: 'foreign-secret' } }), OPENCODE_DB: path.join(foreign, 'shared.db'),
  OPENCODE_CONFIG_CONTENT: JSON.stringify(foreignConfig), OPENCODE_PURE: '1' };
const setup = dataDirectory => {
  const env = createOpenCodeEnvironment(dataDirectory, inherited);
  fs.writeFileSync(path.join(dataDirectory, '.local-access-token'), token);
  const plugin = createOpenCodeStatusPlugin(openCodePaths(dataDirectory).temp);
  return { env: { ...env, MATHMOVER_WINDOW_ID: 'window-fixture', MATHMOVER_COURSEWARE_ID: 'courseware-a',
    [OPENCODE_BYOK_API_KEY_ENV]: apiKey,
    OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent({ statusPluginUrl: plugin.url,
      provider: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model, apiKey, reasoningLevels: ['high'] },
      mcp: { command: process.execPath, args: [path.join(repository, 'packages/daemon/src/mcp-stdio.ts')], env: { MATHMOVER_DAEMON_URL: `http://127.0.0.1:${daemon.address().port}` } },
    }) }, plugin };
};
const run = async (env, sessionId, prompt) => {
  assertOpenCodeWorkspaceIsolated(courseware);
  const events = [], start = performance.now();
  const handle = runAgent({ def: opencode, model, reasoningEffort: 'high', cwd: courseware, resumeSessionId: sessionId,
    prompt, env, mcpConfigPath: path.join(root, 'unused.json'), timeoutMs: 90_000,
    onEvent: event => events.push({ ...event, elapsedMs: Math.round(performance.now() - start) }) });
  const result = await handle.done;
  fs.writeFileSync(path.join(root, sessionId ? 'resume-events.json' : 'first-events.json'), JSON.stringify({ result, events, requests, daemonRequests }, null, 2));
  assert.equal(result.exitCode, 0, JSON.stringify(events.filter(event => event.kind === 'error')));
  assert(!events.some(event => event.kind === 'error'), JSON.stringify(events.filter(event => event.kind === 'error')));
  assert(events.some(event => event.kind === 'text-delta' && event.text.includes('ISOLATION-OK')));
  return { result, events };
};
const sourceRoot = path.join(root, 'before-migration'), isolatedRoot = path.join(root, 'after-migration');
const source = setup(sourceRoot), isolated = setup(isolatedRoot);
try {
  const debug = await spawnCapture(target.command, [...target.prefixArgs, 'debug', 'config'], { env: source.env, cwd: courseware });
  assert.equal(debug.status, 0, JSON.stringify({ stderr: debug.stderr, stdout: debug.stdout }));
  const cfg = JSON.parse(debug.stdout);
  assert.deepEqual(Object.keys(cfg.mcp), ['mathmover']);
  assert.equal(cfg.agent.title.disable, true);
  assert.equal(cfg.plugin.length, 1, 'only the app retry-status plugin is loaded');
  const first = await run(source.env, undefined, 'ISOLATED_FIRST_TURN_MARKER: use the app tools.');
  const sessionId = first.result.sessionId;
  assert(sessionId);
  assert(first.events.some(event => event.kind === 'retry' && event.retryAt), 'retry status bridge remains active');
  assert(first.events.some(event => event.kind === 'tool-call' && event.name === 'get_expert_prompt'));
  assert(first.events.some(event => event.kind === 'tool-result' && !event.isError));
  assert.equal(daemonRequests.length, 1);
  assert.equal(daemonRequests[0].token, token);
  assert.equal(daemonRequests[0].window, 'window-fixture');
  assert.equal(daemonRequests[0].courseware, 'courseware-a');
  for (const request of requests) {
    assert.equal(request.authorization, `Bearer ${apiKey}`);
    assert.equal(request.body.reasoning_effort, 'high');
    assert(!JSON.stringify(request.body).match(/FOREIGN_PROJECT_INSTRUCTION_MARKER|FOREIGN_SKILL_MARKER|foreign-skill|syslab/));
    assert(!JSON.stringify(request.body).includes('Generate a title for this conversation'), 'no extra title model request');
  }
  // Add an unrelated native session in the fixture DB: migration must not copy it.
  const sourceDb = path.join(openCodePaths(sourceRoot).data, 'opencode.db');
  const db = new DatabaseSync(sourceDb);
  const original = db.prepare('SELECT * FROM session WHERE id=?').get(sessionId);
  const other = { ...original, id: 'ses_foreign', directory: foreign };
  const columns = Object.keys(other);
  db.prepare(`INSERT INTO session (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(key => other[key]));
  db.close();
  const beforeHash = digest(sourceDb);
  const migrated = await Promise.all([1, 2].map(() => prepareOpenCodeSession({ sessionId, dataDirectory: isolatedRoot, directory: courseware,
    env: isolated.env, legacyDataDirectory: openCodePaths(sourceRoot).data })));
  assert.deepEqual(migrated, [sessionId, sessionId]);
  assert.equal(digest(sourceDb), beforeHash, 'legacy DB is not modified');
  const privateDb = new DatabaseSync(path.join(openCodePaths(isolatedRoot).data, 'opencode.db'), { readOnly: true });
  assert.equal(privateDb.prepare('SELECT count(*) AS n FROM session').get().n, 1);
  assert.equal(privateDb.prepare('SELECT count(*) AS n FROM session WHERE id=?').get('ses_foreign').n, 0);
  privateDb.close();
  const beforeResume = requests.length;
  const resumed = await run(isolated.env, sessionId, 'ISOLATED_SECOND_TURN_MARKER: continue.');
  assert.equal(resumed.result.sessionId, sessionId);
  assert.equal(requests.length - beforeResume, 1, 'native resume uses imported tool history, without repeating tools');
  assert(JSON.stringify(requests.at(-1).body.messages).includes('ISOLATED_FIRST_TURN_MARKER'));
  assert(JSON.stringify(requests.at(-1).body.messages).includes('ISOLATED_SECOND_TURN_MARKER'));
  assert.equal(await prepareOpenCodeSession({ sessionId: 'ses_missing', dataDirectory: isolatedRoot, directory: courseware, env: isolated.env, legacyDataDirectory: openCodePaths(sourceRoot).data }), undefined);
  assert.equal(await prepareOpenCodeSession({ sessionId, dataDirectory: isolatedRoot, directory: foreign, env: isolated.env, legacyDataDirectory: openCodePaths(sourceRoot).data }), undefined, 'never adopt another workspace');
  assert.equal(fs.existsSync(sentinel), false);
  assert.equal(digest(globalFile), globalBefore);
  const result = { ok: true, scenarios: ['foreign configuration and project instructions excluded', 'external MCP/plugins/skills excluded',
    'app MCP + expert SOP + window credentials', 'retry plugin', 'single model provider and reasoning level', 'duplicate title disabled',
    'selective read-only migration', 'concurrent migration deduplication', 'native resume and workspace isolation'],
    modelRequests: requests.length, firstToolMs: first.events.find(event => event.kind === 'tool-call')?.elapsedMs,
    privatePaths: openCodePaths(isolatedRoot), note: 'Loopback model fixture; timing does not predict live provider latency.' };
  fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  source.plugin.cleanup(); isolated.plugin.cleanup();
  server.closeAllConnections(); daemon.closeAllConnections();
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => daemon.close(resolve))]);
}
