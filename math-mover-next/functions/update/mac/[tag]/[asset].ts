import { methodNotAllowed, proxyUpdateAsset } from '../../../_shared/update-proxy';

type PagesFunctionContext = {
  request: Request;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<unknown>) => void;
};

export async function onRequestGet({ request, params, waitUntil }: PagesFunctionContext): Promise<Response> {
  const tag = params.tag;
  const asset = params.asset;
  if (typeof tag !== 'string' || typeof asset !== 'string') {
    return new Response('Update asset not found', { status: 404 });
  }

  const versionMatch = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  if (!versionMatch) return new Response('Update asset not found', { status: 404 });
  const version = `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}`;
  if (asset !== `MathMover-${version}-mac-arm64.zip` && asset !== `MathMover-${version}-mac-arm64.dmg`) {
    return new Response('Update asset not found', { status: 404 });
  }

  return proxyUpdateAsset({
    request,
    waitUntil,
    upstreamUrl: `https://github.com/Derek-yyang/mathmover/releases/download/${tag}/${asset}`,
    cacheSeconds: 31_536_000,
  });
}

export async function onRequestHead({ request, params, waitUntil }: PagesFunctionContext): Promise<Response> {
  return onRequestGet({ request, params, waitUntil });
}

export function onRequest(): Response { return methodNotAllowed(); }
