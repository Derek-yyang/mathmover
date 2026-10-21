import { libraryToken } from '../../../packages/daemon/src/data-directory';
import { isSameLocalOrigin } from './same-origin';

/**
 * 工作稿读写的同源代理。
 *
 * daemon 拒绝带 Origin 的浏览器直连（CSRF 边界，见 http-api.ts），所以页面
 * 必须经 Next 同源转发——与课件库同一个信任模型。
 *
 * 用处：载入课件后把指令清单同步进工作稿（`construction.ggb.txt`）。
 * 不同步的话画布已是新图、agent 读到的草稿还是上一张的，它会改错对象。
 */
export async function proxyConstruction(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    return Response.json({ error: '本地工作稿仅支持本机工作台' }, { status: 403 });
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (!isSameLocalOrigin(request.url, origin) || (site && !['same-origin', 'none'].includes(site)))
    return Response.json({ error: '工作稿只接受本机工作台请求' }, { status: 403 });

  try {
    const daemon = new URL(process.env.MATHMOVER_DAEMON_URL ?? 'http://127.0.0.1:8788');
    const headers: Record<string, string> = { 'x-mathmover-token': libraryToken() };
    let body: string | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (!request.headers.get('content-type')?.includes('application/json'))
        return Response.json({ error: '需要 JSON 请求' }, { status: 415 });
      body = await request.text();
      headers['content-type'] = 'application/json';
    }
    // 工作稿按**课件**落目录，这个头决定 daemon 去读写哪一份草稿。
    // 不带窗口头：读写草稿是纯文件 I/O，不需要指定画布连接。
    const coursewareId = request.headers.get('x-mathmover-courseware');
    if (coursewareId) headers['x-mathmover-courseware'] = coursewareId;

    const upstream = await fetch(`${daemon.origin}/api/construction`, {
      method: request.method, body, headers, cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ error: '本地服务不可用，请确认 daemon 已启动；未保存内容仍在当前页面' }, { status: 503 });
  }
}
