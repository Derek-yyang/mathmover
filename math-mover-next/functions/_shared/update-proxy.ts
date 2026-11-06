type UpdateProxyInput = {
  request: Request;
  waitUntil: (promise: Promise<unknown>) => void;
  upstreamUrl: string;
  cacheSeconds: number;
};

type UpdateEdgeCache = Pick<Cache, 'match' | 'put'>;

const requestHeaderNames = ['range', 'if-range', 'if-none-match', 'if-modified-since'] as const;
const responseHeaderNames = [
  'accept-ranges',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
] as const;

/** Stream a fixed, allowlisted GitHub release asset through Pages without buffering it. */
export async function proxyUpdateAsset({ request, waitUntil, upstreamUrl, cacheSeconds }: UpdateProxyInput): Promise<Response> {
  const edgeCache = (globalThis as typeof globalThis & {
    caches?: CacheStorage & { default?: UpdateEdgeCache };
  }).caches?.default;
  const cacheable = request.method === 'GET'
    && !request.headers.has('range')
    && !request.headers.has('if-none-match')
    && !request.headers.has('if-modified-since');
  const pathname = new URL(request.url).pathname;
  const cacheKey = new Request(new URL(`/__update_cache${pathname}`, request.url), { method: 'GET' });

  if (cacheable && edgeCache) {
    try {
      const cached = await edgeCache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set('Cache-Control', 'no-store');
        headers.set('X-MathMover-Update', 'cloudflare-edge-cache');
        return new Response(cached.body, { status: cached.status, headers });
      }
    } catch {
      // A cache miss must not interrupt the GitHub stream.
    }
  }

  const headers = new Headers();
  for (const name of requestHeaderNames) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { method: request.method, headers, redirect: 'follow' });
  } catch {
    return new Response('Update server temporarily unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  if (upstream.status >= 500 || upstream.status === 401 || upstream.status === 403) {
    return new Response('Update server temporarily unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (upstream.status >= 400 && upstream.status !== 416) {
    return new Response(upstream.status === 404 ? 'Update asset not found' : 'Update asset request failed', {
      status: upstream.status === 404 ? 404 : 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const responseHeaders = new Headers();
  for (const name of responseHeaderNames) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  responseHeaders.set('X-MathMover-Update', request.headers.has('range') ? 'github-range-proxy' : 'github-proxy-miss');

  const response = new Response(request.method === 'HEAD' || upstream.status === 304 ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });

  const contentLength = Number(upstream.headers.get('content-length'));
  const canCache = Number.isFinite(contentLength) && contentLength > 0 && contentLength <= 512 * 1024 * 1024;
  if (cacheable && upstream.status === 200 && canCache && edgeCache && response.body) {
    const cacheHeaders = new Headers(response.headers);
    cacheHeaders.set('Cache-Control', `public, max-age=${cacheSeconds}`);
    const cacheResponse = new Response(response.clone().body, { status: 200, headers: cacheHeaders });
    waitUntil(edgeCache.put(cacheKey, cacheResponse).catch(() => undefined));
  }

  return response;
}

export function methodNotAllowed(): Response {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
  });
}
