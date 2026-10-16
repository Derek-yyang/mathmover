/**
 * daemon 的 HTTP 工具面 —— 让同机其他进程（Next.js 路由处理器）能调用工具。
 *
 * 为什么需要：agent 循环跑在 Next.js 路由里（同源，避开浏览器 Local Network Access
 * 对跨端口请求的拦截），而画布连在 daemon 的 WebSocket 上。这层是两者之间的桥。
 *
 * 安全：只绑 127.0.0.1；课件库和指定窗口接口要求本地令牌，拒绝浏览器直连。
 */

import http from 'node:http';
import type { GgbTools } from './tools.ts';
import { libraryRequest, authorized, type LibraryServices } from './courseware-http.ts';
import { GGB_ERROR, CoursewareError } from '@mathmover/ggb-core';

export interface HttpApiOptions {
  port: number;
  host?: string;
  library?: LibraryServices;
  /**
   * 按请求构造工具面。两个键各管一件事：
   *  - `id`（窗口）= 哪块活画布（找 WebSocket 连接）；缺省 = 用默认画布
   *  - `coursewareId` = 哪份工作稿（定 `workspaces/<id>/`）；缺省 = `_default`
   */
  toolsForWindow?: (id: string | undefined, coursewareId?: string) => GgbTools;
}

/** 目录名/头的取值域——与前端生成课件 id 的形态一致（UUID）。 */
const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/;

const CORS = {
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
    // Browsers must use the same-origin Next proxy. Loopback alone is not a CSRF boundary.
    if (req.headers.origin || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'none')) return json(res, 403, { error: '请通过工作台访问本地服务' });
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }

    try {
      if (opts.library && await libraryRequest(req, res, url, opts.library)) return;
      const windowId = req.headers['x-mathmover-window'];
      const coursewareId = req.headers['x-mathmover-courseware'];
      // 两个头都要求本地令牌：它们都能间接决定服务端去读写哪块画布/哪个文件。
      if (windowId && (!opts.library || !authorized(req, opts.library.token) || typeof windowId !== 'string' || !SAFE_ID.test(windowId))) return json(res, 403, { error: '窗口访问校验失败' });
      if (coursewareId && (!opts.library || !authorized(req, opts.library.token) || typeof coursewareId !== 'string' || !SAFE_ID.test(coursewareId))) return json(res, 403, { error: '课件访问校验失败' });
      // 只带课件 id 的调用（前端同步草稿走这条）拿默认画布——那几个操作是纯文件 I/O。
      const activeTools = opts.toolsForWindow && (windowId || coursewareId)
        ? opts.toolsForWindow(typeof windowId === 'string' ? windowId : undefined,
            typeof coursewareId === 'string' ? coursewareId : undefined)
        : tools;
      // 健康检查：画布是否连着
      if (url.pathname === '/api/health' && req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          canvasConnected: activeTools.ping(),
          snapshotGeneration: null,
        });
      }

      // 读状态
      if (url.pathname === '/api/state' && req.method === 'GET') {
        const png = url.searchParams.get('png') !== '0';
        return json(res, 200, await activeTools.getState({ png }));
      }

      // 写入：commands 缺省时由 tools 读工作稿 construction.ggb.txt
      if (url.pathname === '/api/apply' && req.method === 'POST') {
        const body = (await readBody(req)) as { commands?: string[]; png?: boolean; incremental?: boolean };
        if (body.commands !== undefined && !Array.isArray(body.commands)) {
          return json(res, 400, { error: 'commands 必须是数组' });
        }
        return json(res, 200, await activeTools.apply(body.commands, {
          png: body.png ?? true,
          incremental: body.incremental,
        }));
      }

      // 工作稿读写（BYOK 等无原生文件能力的 agent 走这条）
      if (url.pathname === '/api/construction' && req.method === 'GET') {
        return json(res, 200, await activeTools.readConstruction());
      }
      if (url.pathname === '/api/construction' && req.method === 'PUT') {
        const body = (await readBody(req)) as { commands?: string[] };
        // 空数组合法：空课件要能清空草稿（同步载入结果时会遇到）
        if (!Array.isArray(body.commands)) {
          return json(res, 400, { error: '缺少 commands 数组' });
        }
        return json(res, 200, { file: await activeTools.writeConstruction(body.commands) });
      }

      // 清空
      if (url.pathname === '/api/reset' && req.method === 'POST') {
        await activeTools.reset();
        return json(res, 200, { ok: true });
      }

      json(res, 404, { error: `未知路径: ${url.pathname}` });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      const status = e instanceof CoursewareError ? e.status : msg.includes(GGB_ERROR.SESSION_DEAD) ? 503 : 500;
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
