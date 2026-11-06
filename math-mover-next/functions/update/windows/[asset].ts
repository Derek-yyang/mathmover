import { methodNotAllowed, proxyUpdateAsset } from '../../_shared/update-proxy';

type PagesFunctionContext = {
  request: Request;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<unknown>) => void;
};

const releaseRoot = 'https://github.com/Derek-yyang/mathmover/releases';

async function handle({ request, params, waitUntil }: PagesFunctionContext): Promise<Response> {
  const asset = params.asset;
  if (typeof asset !== 'string') return new Response('Update asset not found', { status: 404 });

  if (asset === 'latest.yml') {
    return proxyUpdateAsset({
      request,
      waitUntil,
      upstreamUrl: `${releaseRoot}/latest/download/latest.yml`,
      cacheSeconds: 30,
    });
  }

  const match = /^MathMover-(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-Setup\.exe(?:\.blockmap)?$/.exec(asset);
  if (!match) return new Response('Update asset not found', { status: 404 });

  const version = `${match[1]}.${match[2]}.${match[3]}`;
  return proxyUpdateAsset({
    request,
    waitUntil,
    upstreamUrl: `${releaseRoot}/download/v${version}/${asset}`,
    cacheSeconds: 31_536_000,
  });
}

export const onRequestGet = handle;
export const onRequestHead = handle;
export function onRequest(): Response { return methodNotAllowed(); }
