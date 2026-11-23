import { publicConfig } from '../../../server/config';
export const dynamic = 'force-dynamic';
export function GET() { return Response.json(publicConfig(), { headers: { 'cache-control': 'no-store' } }); }
