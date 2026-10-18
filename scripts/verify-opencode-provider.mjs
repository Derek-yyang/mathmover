/**
 * 内置 Agent（OpenCode）provider 块验证 —— 我们**自造的 provider 配置真的能用**。
 *
 * 这一块是照 OpenDesign 的生产代码 + opencode 文档写的，没有真端点可打（本机没有
 * 可用的 BYOK 端点），所以起一个**本地的 OpenAI 兼容 mock** 来验，比真端点更确定：
 *   - 模型 id `mathmover-byok/<模型>` 能不能被解析到我们那份 provider 上
 *   - `apiKey: '{env:MATHMOVER_BYOK_API_KEY}'` 这个引用能不能真的把子进程环境里的
 *     密钥取出来、并作为 Authorization 头发到端点上
 *   - baseURL 有没有被正确拼上 /chat/completions
 *
 * 用法同 verify-opencode-builtin.mjs。
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const { opencode, runAgent, resolveRuntimeTarget, buildOpenCodeConfigContent, OPENCODE_BYOK_API_KEY_ENV } =
  await import(`file:///${REPO.replace(/\\/g, '/')}/packages/agent-runtime/src/index.ts`);

if (!resolveRuntimeTarget(opencode)) {
  console.error('✗ 解不出 opencode 的可执行文件（设 OPENCODE_BIN）');
  process.exit(2);
}

const API_KEY = 'mm-mock-key-abc123';
const MODEL = 'mock-model';
const REPLY = 'MOCK-OK';
const seen = [];

/** 1×1 的透明 PNG——只要能被当成图片附件走完链路就够，不必有内容。 */
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const sse = (chunks) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization ?? null, body: (() => { try { return JSON.parse(body); } catch { return null; } })() });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(sse([
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: MODEL, choices: [{ index: 0, delta: { role: 'assistant', content: REPLY }, finish_reason: null }] },
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}/v1`;

const config = buildOpenCodeConfigContent({
  provider: { baseUrl, model: MODEL, apiKey: API_KEY },
  mcp: null,
});
const parsed = JSON.parse(config);
console.log(`mock 端点：${baseUrl}`);
console.log(`provider  : ${JSON.stringify(parsed.provider['mathmover-byok'].options)}`);
console.log(`声明的模型：${Object.keys(parsed.provider['mathmover-byok'].models).join(',')}\n`);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-oc-provider-'));
let text = '';
const errors = [];
const handle = runAgent({
  def: opencode,
  prompt: '只回复 MOCK-OK 这七个字符，不要做别的。',
  mcpConfigPath: path.join(REPO, 'packages', 'daemon', 'mcp', 'runtime-mcp.json'),
  cwd: sandbox,
  model: MODEL,   // 定义会加上 mathmover-byok/ 前缀
  // 题目图片：落盘进工作区（imageMaterializeInCwd）后以 --file=<路径> 递送
  images: [{ mediaType: 'image/png', base64: TINY_PNG, name: 'probe.png' }],
  env: {
    OPENCODE_CONFIG_CONTENT: config,
    // 密钥走环境变量，配置里只放 {env:…} 引用
    [OPENCODE_BYOK_API_KEY_ENV]: API_KEY,
  },
  inactivityTimeoutMs: 90_000,
  firstOutputTimeoutMs: 90_000,
  onEvent: (e) => {
    if (e.kind === 'text' || e.kind === 'text-delta') text += e.text;
    if (e.kind === 'error') errors.push(e.message);
  },
});
const { exitCode } = await handle.done;
const argv = (handle.proc?.spawnargs ?? []).join(' ');
const hit = seen.find((s) => s.url?.includes('/chat/completions'));
const fileArg = /--file=(\S+)/.exec(argv)?.[1];
// 请求体里找图片块：OpenAI 兼容方言是 {type:'image_url', image_url:{url:'data:…'}}
const parts = ((hit?.body?.messages ?? [])).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
const imageParts = parts.filter((p) => p?.type === 'image_url' || p?.type === 'image');
const leftover = fs.readdirSync(sandbox).filter((n) => n.startsWith('mm-img-'));

console.log(`argv 里的模型：${/-m (\S+)/.exec(argv)?.[1] ?? '(没有 -m)'}`);
console.log(`argv 里的附件：${fileArg ?? '(没有 --file)'}`);
console.log(`端点收到：${hit ? `${hit.url} model=${hit.body?.model}，${imageParts.length} 个图片块` : '(没收到)'}`);
console.log(`正文：「${text.trim().slice(0, 80)}」\n`);

const checks = [
  ['argv 用 mathmover-byok/<模型> 形式', argv.includes(`-m mathmover-byok/${MODEL}`)],
  ['端点被真的调到（baseURL 拼对了）', Boolean(hit)],
  ['端点收到的 model 是我们声明的那个', hit?.body?.model === MODEL],
  [`{env:…} 引用取到了密钥（Authorization: Bearer …）`, hit?.auth === `Bearer ${API_KEY}`],
  ['配置里没有明文密钥（只有引用）', !config.includes(API_KEY)],
  ['取回并下发了模型的正文', text.includes(REPLY)],
  ['附件落在工作区内（工作区外的文件会被它自己的策略拒）', Boolean(fileArg) && path.resolve(fileArg).startsWith(path.resolve(sandbox))],
  ['图片真的到了端点（data:image/png;base64,…）', imageParts.some((p) => String(p?.image_url?.url ?? p?.source?.data ?? '').includes('data:image/png;base64,'))],
  ['跑完清掉了临时图目录', leftover.length === 0],
  ['退出码为 0 且无 error', exitCode === 0 && errors.length === 0],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? '✓' : '✗'} ${label}`); if (!ok) failed++; }
if (errors.length) console.log(`\nerror 事件：${errors.join(' | ')}`);
server.close();
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* 清理失败不致命 */ }
process.exit(failed ? 1 : 0);
