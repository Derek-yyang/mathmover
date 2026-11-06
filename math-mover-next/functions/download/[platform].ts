type PagesFunctionContext = {
  request: Request;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<unknown>) => void;
};

type DownloadEdgeCache = Pick<Cache, 'match' | 'put'>;

const releaseAssets = {
  windows: {
    url: 'https://github.com/Derek-yyang/mathmover/releases/latest/download/MathMover-Setup.exe',
    fileName: 'MathMover-Setup.exe',
  },
  mac: {
    url: 'https://github.com/Derek-yyang/mathmover/releases/latest/download/MathMover-mac-arm64.dmg',
    fileName: 'MathMover-mac-arm64.dmg',
  },
} as const;

const requestHeaderNames = ['range', 'if-range', 'if-none-match', 'if-modified-since'] as const;
const responseHeaderNames = [
  'accept-ranges',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
] as const;

function githubFallback(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': 'no-store',
      'X-MathMover-Download': 'github-fallback',
    },
  });
}

async function proxyDownload({ request, params, waitUntil }: PagesFunctionContext): Promise<Response> {
  const platform = params.platform;
  const asset = typeof platform === 'string' && Object.hasOwn(releaseAssets, platform)
    ? releaseAssets[platform as keyof typeof releaseAssets]
    : undefined;

  if (!asset) return new Response('Download not found', { status: 404 });

  const edgeCache = (globalThis as typeof globalThis & {
    caches?: CacheStorage & { default?: DownloadEdgeCache };
  }).caches?.default;
  const cacheable = request.method === 'GET'
    && !request.headers.has('range')
    && !request.headers.has('if-none-match')
    && !request.headers.has('if-modified-since');
  const cacheKey = new Request(new URL(`/__download_cache/${platform}`, request.url), { method: 'GET' });

  if (cacheable && edgeCache) {
    try {
      const cached = await edgeCache.match(cacheKey);
      if (cached) {
        const cachedHeaders = new Headers(cached.headers);
        cachedHeaders.set('Cache-Control', 'private, no-store');
        cachedHeaders.set('X-MathMover-Download', 'cloudflare-edge-cache');
        return new Response(cached.body, { status: cached.status, headers: cachedHeaders });
      }
    } catch {
      // A cache miss must not block the GitHub stream.
    }
  }

  const headers = new Headers();
  for (const name of requestHeaderNames) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(asset.url, {
      method: request.method,
      headers,
      redirect: 'follow',
    });
  } catch {
    return githubFallback(asset.url);
  }

  if (upstream.status >= 500) return githubFallback(asset.url);
  if (upstream.status >= 400 && upstream.status !== 416) {
    return new Response('The release asset is temporarily unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const responseHeaders = new Headers();
  for (const name of responseHeaderNames) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set('Content-Disposition', `attachment; filename="${asset.fileName}"`);
  responseHeaders.set('Cache-Control', 'private, no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  responseHeaders.set('X-MathMover-Download', request.headers.has('range') ? 'github-range-proxy' : 'github-proxy-miss');

  const body = request.method === 'HEAD' || upstream.status === 304 ? null : upstream.body;
  const response = new Response(body, { status: upstream.status, headers: responseHeaders });

  const contentLength = Number(upstream.headers.get('content-length'));
  const cacheableSize = Number.isFinite(contentLength) && contentLength > 0 && contentLength <= 512 * 1024 * 1024;
  if (cacheable && upstream.status === 200 && cacheableSize && edgeCache && response.body && request.method === 'GET') {
    const cacheHeaders = new Headers(response.headers);
    cacheHeaders.set('Cache-Control', 'public, max-age=300');
    const cacheResponse = new Response(response.clone().body, { status: 200, headers: cacheHeaders });
    const cacheWrite = edgeCache.put(cacheKey, cacheResponse).catch(() => undefined);
    waitUntil(cacheWrite);
  }

  return response;
}

export const onRequestGet = proxyDownload;
export const onRequestHead = proxyDownload;

export function onRequest({ request }: PagesFunctionContext): Response {
  return new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
  });
}
