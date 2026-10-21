import { libraryToken } from '../../../packages/daemon/src/data-directory';
import { isSameLocalOrigin } from './same-origin';

export async function proxyLibrary(request: Request, parts: string[] = []): Promise<Response> {
  const url = new URL(request.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    return Response.json({ error: '本地课件库仅支持本机工作台' }, { status: 403 });
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (!isSameLocalOrigin(request.url, origin) || (site && !['same-origin', 'none'].includes(site)))
    return Response.json({ error: '课件库只接受本机工作台请求' }, { status: 403 });
  if (parts.some(p => !/^[a-zA-Z0-9_.-]+$/.test(p) || p === '.' || p === '..'))
    return Response.json({ error: '课件路径无效' }, { status: 400 });
  try {
    const daemon = new URL(process.env.MATHMOVER_DAEMON_URL ?? 'http://127.0.0.1:8788');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(daemon.hostname)) throw new Error('课件库必须在本机');
    const headers: Record<string, string> = { 'x-mathmover-token': libraryToken() };
    let body: string | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({ error: '需要 JSON 请求' }, { status: 415 });
      body = await request.text();
      if (Buffer.byteLength(body) > 64 * 1024 * 1024) return Response.json({ error: '课件请求过大' }, { status: 413 });
      headers['content-type'] = 'application/json';
    }
    const upstream = await fetch(`${daemon.origin}/api/coursewares${parts.length ? '/' + parts.join('/') : ''}${url.search}`, {
      method: request.method, body, headers, cache: 'no-store', signal: AbortSignal.timeout(60_000),
    });
    return new Response(upstream.body, { status: upstream.status, headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': parts[0] === 'assets' ? 'private, max-age=31536000, immutable' : 'no-store',
      'x-content-type-options': 'nosniff',
    } });
  } catch {
    return Response.json({ error: '本地课件库不可用，请确认 daemon 已启动，且与前端使用相同的 MATHMOVER_DATA_DIR；未保存内容仍在当前页面' }, { status: 503 });
  }
}
