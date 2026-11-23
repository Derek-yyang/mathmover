import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { validateGgbSnapshot } from '../../packages/daemon/src/ggb-snapshot.ts';
import type { SessionStore, CanvasSession } from './sessions.ts';

export type CanvasControlHandlers = {
  open: (args: { session_id?: string; title?: string }) => Promise<unknown>;
  list: () => Promise<unknown>;
  call: (args: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
  shutdown?: () => void;
};

export type CanvasServerOptions = {
  controlToken?: string;
  control?: CanvasControlHandlers;
};

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.gif': 'image/gif', '.txt': 'text/plain; charset=utf-8',
};

function tokenMatches(token: string | undefined, expectedToken: string | undefined) {
  if (!token || !expectedToken) return false;
  const actual = Buffer.from(token);
  const expected = Buffer.from(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function authorized(token: string | undefined, session: CanvasSession | undefined) {
  return Boolean(session) && tokenMatches(token, session?.token);
}

async function readBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 24 * 1024 * 1024) throw Object.assign(new Error('画板快照超过大小限制'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function serveCanvas(store: SessionStore, publicDir: string, options: CanvasServerOptions = {}) {
  let origin = '';
  const sendJson = (response: http.ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (`http://${request.headers.host}` !== origin || (request.headers.origin && request.headers.origin !== origin)) {
      sendJson(response, 403, { error: '无效的本地画板来源' });
      return;
    }
    try {
      const url = new URL(request.url ?? '/', origin);
      const libraryMatch = /^\/api\/canvases(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname);
      if (libraryMatch) {
        const token = request.headers.authorization?.replace(/^Bearer /, '');
        if (!tokenMatches(token, store.managementToken)) {
          sendJson(response, 403, { error: '课件管理凭证无效，请重新打开画板。' }); return;
        }
        const canvasId = libraryMatch[1];
        if (!canvasId && request.method === 'GET') {
          sendJson(response, 200, await store.list()); return;
        }
        if (request.method === 'POST' && options.control) {
          const body = await readBody(request);
          if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 100)) {
            sendJson(response, 400, { error: '课件名称需为 1–100 个字符' }); return;
          }
          sendJson(response, 200, await options.control.open({ session_id: canvasId, title: body.title })); return;
        }
        if (canvasId && request.method === 'PATCH') {
          const body = await readBody(request);
          if (typeof body.title !== 'string') { sendJson(response, 400, { error: '请填写课件名称' }); return; }
          sendJson(response, 200, await store.rename(canvasId, body.title)); return;
        }
        if (canvasId && request.method === 'DELETE') {
          await store.remove(canvasId);
          sendJson(response, 200, { deleted: true }); return;
        }
        sendJson(response, 405, { error: '不支持的课件管理操作' }); return;
      }
      const controlMatch = /^\/api\/control\/(health|open|list|call|shutdown)$/.exec(url.pathname);
      if (controlMatch) {
        const token = request.headers.authorization?.replace(/^Bearer /, '');
        if (!options.control || !tokenMatches(token, options.controlToken)) {
          sendJson(response, 403, { error: '本地画板控制凭证无效' });
          return;
        }
        const action = controlMatch[1];
        if (action === 'health') {
          if (request.method !== 'GET') { sendJson(response, 405, { error: '不支持的画板控制操作' }); return; }
          sendJson(response, 200, { ok: true, pid: process.pid });
          return;
        }
        if (action === 'list') {
          if (request.method !== 'GET') { sendJson(response, 405, { error: '不支持的画板控制操作' }); return; }
          sendJson(response, 200, await options.control.list());
          return;
        }
        if (request.method !== 'POST') { sendJson(response, 405, { error: '不支持的画板控制操作' }); return; }
        if (action === 'open') {
          sendJson(response, 200, await options.control.open(await readBody(request)));
          return;
        }
        if (action === 'call') {
          const body = await readBody(request);
          if (typeof body.name !== 'string' || !body.arguments || typeof body.arguments !== 'object' || Array.isArray(body.arguments)) {
            sendJson(response, 400, { error: '工具调用参数无效' });
            return;
          }
          sendJson(response, 200, await options.control.call({ name: body.name, arguments: body.arguments }));
          return;
        }
        if (!options.control.shutdown) { sendJson(response, 503, { error: '画板服务不支持关闭操作' }); return; }
        sendJson(response, 200, { stopping: true });
        setImmediate(options.control.shutdown);
        return;
      }
      const apiMatch = /^\/api\/sessions\/([a-f0-9-]{36})(\/snapshot)?$/.exec(url.pathname);
      if (apiMatch) {
        const session = store.loaded.get(apiMatch[1]);
        const token = request.headers.authorization?.replace(/^Bearer /, '');
        if (!authorized(token, session)) { sendJson(response, 403, { error: '画板访问凭证无效，请通过 Agent 重新打开会话。' }); return; }
        const current = session!;
        if (request.method === 'GET' && !apiMatch[2]) {
          const snapshot = JSON.parse(await fs.readFile(path.join(current.directory, 'snapshot.json'), 'utf8').catch(() => 'null'));
          const commands = JSON.parse(await fs.readFile(path.join(current.directory, 'applied.json'), 'utf8').catch(() => '[]'));
          const matchingSnapshot = snapshot && JSON.stringify(snapshot.commands) === JSON.stringify(commands);
          const { accessToken, ...sessionInfo } = current.info;
          void accessToken;
          sendJson(response, 200, { ...sessionInfo, managementToken: store.managementToken, workfile: current.workfile, commands, snapshot: matchingSnapshot ? snapshot.base64 : null });
          return;
        }
        if (request.method === 'PUT' && apiMatch[2]) {
          const body = await readBody(request);
          if (typeof body.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64) || !Array.isArray(body.commands)) {
            sendJson(response, 400, { error: '画板快照格式无效' }); return;
          }
          const bytes = Buffer.from(body.base64, 'base64');
          validateGgbSnapshot(bytes);
          await current.run(async () => {
            const applied = JSON.parse(await fs.readFile(path.join(current.directory, 'applied.json'), 'utf8').catch(() => '[]'));
            if (JSON.stringify(applied) !== JSON.stringify(body.commands)) throw Object.assign(new Error('画板正在更新，稍后重试保存'), { status: 409 });
            const file = path.join(current.directory, 'snapshot.json');
            await fs.writeFile(`${file}.tmp`, JSON.stringify({ base64: body.base64, commands: body.commands }), 'utf8');
            await fs.rename(`${file}.tmp`, file);
          });
          sendJson(response, 200, { saved: true });
          return;
        }
        sendJson(response, 405, { error: '不支持的画板操作' });
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') { sendJson(response, 405, { error: '不支持的请求' }); return; }
      let relative: string;
      if (/^\/canvas\/[a-f0-9-]{36}$/.test(url.pathname)) relative = 'index.html';
      else if (url.pathname === '/canvas.js' || url.pathname === '/canvas.css' || url.pathname.startsWith('/vendor/geogebra/')) relative = decodeURIComponent(url.pathname.slice(1));
      else { sendJson(response, 404, { error: '请通过 mathmover_open_canvas 打开画板' }); return; }
      const file = path.resolve(publicDir, relative);
      if (!file.startsWith(path.resolve(publicDir) + path.sep)) { sendJson(response, 403, { error: '无效资源路径' }); return; }
      const stat = await fs.stat(file);
      if (!stat.isFile()) { sendJson(response, 404, { error: '资源不存在' }); return; }
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      sendJson(response, (error as { status?: number }).status ?? 400, { error: error instanceof Error ? error.message : '画板服务请求失败' });
    }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', origin); }
    catch { socket.destroy(); return; }
    const match = /^\/ws\/([a-f0-9-]{36})$/.exec(url.pathname);
    const session = match ? store.loaded.get(match[1]) : undefined;
    if (`http://${request.headers.host}` !== origin || request.headers.origin !== origin || !authorized(url.searchParams.get('token') ?? undefined, session)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(request, socket, head, ws => session!.bridge.attach(ws));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法启动本地画板服务');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    async close() {
      for (const socket of sockets.clients) socket.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
