import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { CanvasChannel, type Socket } from './channel';

const fixture = vi.hoisted(() => ({ baseUrl: '' }));
const blobFixture = vi.hoisted(() => ({ puts: [] as unknown[], deleted: [] as string[] }));
vi.mock('./config', () => ({
  onlineConfig: () => ({ ready: true, apiKey: 'local-fixture-only', baseUrl: fixture.baseUrl, model: 'agnes-3.0-flash', apiFormat: 'openai-chat' }),
  resolveRunConfig: () => ({ apiKey: 'local-fixture-only', baseUrl: fixture.baseUrl, model: 'agnes-3.0-flash', apiFormat: 'openai-chat' }),
}));
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (pathname: string, body: Buffer, options: unknown) => {
    blobFixture.puts.push({ pathname, body, options });
    return { url: 'https://mathmover.top/workflow-preview/function.png' };
  }),
  del: vi.fn(async (urls: string | string[]) => {
    blobFixture.deleted.push(...(Array.isArray(urls) ? urls : [urls]));
  }),
}));
import { runOnline } from './run';

it('runs the bundled OpenCode, edits a temporary draft and applies it through the actual MCP child', async () => {
  let draft = ''; let requests = 0; let step = 0;
  const provider = http.createServer(async (req, res) => {
    let bytes = ''; for await (const chunk of req) bytes += chunk;
    const body = JSON.parse(bytes); requests++;
    const prompt = body.messages?.find((message: any) =>
      message.role === 'user' && typeof message.content === 'string' && message.content.includes('工作稿路径：'));
    const match = prompt?.content.match(/工作稿路径：([^\n]+)/);
    if (match) draft = match[1].trim();
    const applyTool = body.tools?.find((t: any) => t.function.name.endsWith('ggb_apply'))?.function.name;
    let tool: { name: string; arguments: string } | undefined;
    if (applyTool && step === 0) { step++; tool = { name: 'write', arguments: JSON.stringify({ filePath: draft, content: 'E: x^2/9+y^2/4=1\nP=Point(E)\n' }) }; }
    else if (applyTool && step === 1) { step++; tool = { name: applyTool, arguments: '{}' }; }
    const message = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_${step}`, type: 'function', function: tool }] }
      : { role: 'assistant', content: '<mm-title>椭圆动点</mm-title>图形已构建。' };
    const completion = { id: `completion_${requests}`, object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
    if (!body.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(completion)); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ ...completion, object: 'chat.completion.chunk', choices: [{ index: 0, delta: message, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...completion, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  fixture.baseUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
  const events: any[] = []; let applied: string[] = [];
  let channel: CanvasChannel;
  const state = () => ({ commands: applied, names: applied.length ? ['E', 'P'] : [],
    objects: applied.length ? { E: { type: 'conic', value: 'x²/9 + y²/4 = 1', independent: true }, P: { type: 'point', value: '(3,0)', independent: false } } : {},
    sliders: [], png: null, pngSource: 'none', generation: 1 });
  const socket = { readyState: 1, send: (data: string) => {
    const message = JSON.parse(data); events.push(message);
    if (message.type !== 'canvas') return;
    if (message.op === 'apply') applied = message.args.ledger ?? message.args.commands;
    const payload = message.op === 'apply' ? { state: state(), applied, failedFirstPass: [], durationMs: 1 } : state();
    queueMicrotask(() => channel.receive({ type: 'canvas-result', id: message.id, payload }));
  } } as Socket;
  channel = new CanvasChannel(socket);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
  try {
    await runOnline(channel, { text: '创建一个椭圆和动点。' }, controller.signal);
    expect(requests).toBeGreaterThanOrEqual(3);
    expect(applied).toContain('P=Point(E)');
    expect(events.some(e => e.type === 'event' && e.event.kind === 'title')).toBe(true);
    expect(events.filter(e => e.type === 'event' && e.event.kind === 'error')).toEqual([]);
    expect(draft).not.toBe('');
    await expect(fs.access(draft)).rejects.toThrow();
  } finally { clearTimeout(timer); controller.abort(); channel.dispose(); provider.closeAllConnections(); await new Promise<void>(resolve => provider.close(() => resolve())); }
});

it('temporarily publishes attached images and forwards their public URLs to the provider', async () => {
  const requestBodies: any[] = [];
  let requests = 0;
  const provider = http.createServer(async (req, res) => {
    let bytes = ''; for await (const chunk of req) bytes += chunk;
    const body = JSON.parse(bytes);
    requests += 1;
    requestBodies.push(body);
    const completion = {
      id: 'image_completion', object: 'chat.completion', created: 1, model: 'fixture',
      choices: [{ index: 0, message: { role: 'assistant', content: '<mm-title>题图</mm-title>图片已读取。' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(completion)); return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ ...completion, object: 'chat.completion.chunk', choices: [{ index: 0, delta: completion.choices[0].message, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ ...completion, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
  fixture.baseUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}/v1`;
  const events: unknown[] = [];
  const channel = new CanvasChannel({ readyState: 1, send: (data: string) => { events.push(JSON.parse(data)); }, close: () => {}, on: () => {} });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
  const previousBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = 'fixture';
  try {
    await runOnline(channel, {
      text: '请识别这张题图。',
      images: [{
        mediaType: 'image/png',
        base64: readFileSync('public/workflow-preview/function.png').toString('base64'),
        name: 'function.png',
      }],
    }, controller.signal);
    expect(requests).toBe(1);
    const userMessage = requestBodies[0].messages.find((message: any) => message.role === 'user');
    const expectedUrl = 'https://mathmover.top/workflow-preview/function.png';
    expect(userMessage.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'image_url',
        image_url: expect.objectContaining({ url: expectedUrl }),
      }),
    ]));
    expect(blobFixture.deleted).toContain(expectedUrl);
    expect(JSON.stringify(requestBodies[0].messages)).not.toContain('data:image/');
    expect(JSON.stringify(requestBodies[0].messages)).not.toContain('已从题图提取并验证的数学信息');
    expect(events.filter((message: any) => message.type === 'event' && message.event?.kind === 'error')).toEqual([]);
  } finally {
    if (previousBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previousBlobToken;
    clearTimeout(timer); controller.abort(); channel.dispose(); provider.closeAllConnections();
    await new Promise<void>(resolve => provider.close(() => resolve()));
  }
});
