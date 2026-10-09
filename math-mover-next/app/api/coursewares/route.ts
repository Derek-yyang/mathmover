import { proxyLibrary } from '@/lib/server/library-proxy';
export const runtime = 'nodejs';
export const GET = (request: Request) => proxyLibrary(request);
export const POST = (request: Request) => proxyLibrary(request);
