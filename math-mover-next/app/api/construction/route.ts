import { proxyConstruction } from '@/lib/server/construction-proxy';
export const runtime = 'nodejs';
export const GET = (request: Request) => proxyConstruction(request);
export const PUT = (request: Request) => proxyConstruction(request);
