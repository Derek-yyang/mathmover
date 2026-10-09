/**
 * daemon 的 HTTP 工具面 —— 让同机其他进程（Next.js 路由处理器）能调用工具。
 *
 * 为什么需要：agent 循环跑在 Next.js 路由里（同源，避开浏览器 Local Network Access
 * 对跨端口请求的拦截），而画布连在 daemon 的 WebSocket 上。这层是两者之间的桥。
 *
 * 安全：只绑 127.0.0.1，仅回环可达，无鉴权（同机信任边界）。
 */

import http from 'node:http';
import type { GgbTools } from './tools.ts';

export interface HttpApiOptions {
  port: number;
  host?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

export function createHttpServer(tools: GgbTools, opts: HttpApiOptions): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }

    try {
      // 健康检查：画布是否连着
      if (url.pathname === '/api/health' && req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          canvasConnected: tools.ping(),
          snapshotGeneration: null,
        });
      }

      // 读状态
      if (url.pathname === '/api/state' && req.method === 'GET') {
        const png = url.searchParams.get('png') !== '0';
        return json(res, 200, await tools.getState({ png }));
      }

      // 全量写入
      if (url.pathname === '/api/apply' && req.method === 'POST') {
        const body = (await readBody(req)) as { commands?: string[]; png?: boolean };
        if (!Array.isArray(body.commands)) {
          return json(res, 400, { error: '缺少 commands 数组' });
        }
        return json(res, 200, await tools.apply(body.commands, { png: body.png ?? true }));
      }

      // 比较两份清单
      if (url.pathname === '/api/diff' && req.method === 'POST') {
        const body = (await readBody(req)) as { before?: string[]; after?: string[] };
        return json(res, 200, tools.diff(body.before ?? [], body.after ?? []));
      }

      // 清空
      if (url.pathname === '/api/reset' && req.method === 'POST') {
        await tools.reset();
        return json(res, 200, { ok: true });
      }

      json(res, 404, { error: `未知路径: ${url.pathname}` });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      const status = msg.includes('GGB_SESSION_DEAD') ? 503 : 500;
      json(res, status, { error: msg });
    }
  });
}

export function listenHttp(tools: GgbTools, opts: HttpApiOptions): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = createHttpServer(tools, opts);
    server.on('error', reject);
    server.listen(opts.port, opts.host ?? '127.0.0.1', () => resolve(server));
  });
}
