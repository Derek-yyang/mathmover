import { proxyLibrary } from '@/lib/server/library-proxy';
export const runtime = 'nodejs';
type Context = { params: Promise<{ path: string[] }> };
export const GET = async (request: Request, context: Context) => proxyLibrary(request, (await context.params).path);
export const POST = GET;
