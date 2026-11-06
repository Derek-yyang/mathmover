import { methodNotAllowed, proxyUpdateAsset } from '../../_shared/update-proxy';

type PagesFunctionContext = {
  request: Request;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<unknown>) => void;
};

export async function onRequestGet({ request, params, waitUntil }: PagesFunctionContext): Promise<Response> {
  if (params.asset !== 'appcast-mac-arm64.xml') {
    return new Response('Update asset not found', { status: 404 });
  }
  return proxyUpdateAsset({
    request,
    waitUntil,
    // The signed feed must be delivered byte-for-byte; do not rewrite its enclosure URL.
    upstreamUrl: 'https://github.com/Derek-yyang/mathmover/releases/latest/download/appcast-mac-arm64.xml',
    cacheSeconds: 30,
  });
}

export async function onRequestHead({ request, params, waitUntil }: PagesFunctionContext): Promise<Response> {
  return onRequestGet({ request, params, waitUntil });
}

export function onRequest(): Response { return methodNotAllowed(); }
