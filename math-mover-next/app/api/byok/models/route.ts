import { dataDirectory } from '../../../../../packages/daemon/src/data-directory.ts';
import { isApiFormat } from '../../../../../packages/agent-runtime/src/api-format.ts';
import { loadByokConfig } from '@/lib/byok-store';
import { fetchByokModels } from '@/lib/byok-probe';

/** Read-only discovery from a draft. Never persists draft fields or returns stored keys. */
export async function POST(req: Request): Promise<Response> {
  const headers = { 'cache-control': 'no-store' };
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) {
    return Response.json({ error: '只接受工作台同源请求' }, { status: 403, headers });
  }
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: '配置必须是 JSON 对象' }, { status: 400, headers });
  }
  const draft = body as Record<string, unknown>;
  if (!isApiFormat(draft.apiFormat) || typeof draft.baseUrl !== 'string' || (draft.apiKey !== undefined && typeof draft.apiKey !== 'string')) {
    return Response.json({ error: '请检查接口格式、API 端点和密钥。' }, { status: 400, headers });
  }
  const baseUrl = draft.baseUrl.trim();
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid endpoint');
  } catch {
    return Response.json({ error: '请填写有效的 HTTP(S) 基础地址，包含版本路径，无需查询参数。' }, { status: 400, headers });
  }
  const apiKey = (typeof draft.apiKey === 'string' ? draft.apiKey.trim() : '') || loadByokConfig(dataDirectory())?.apiKey || '';
  return Response.json(await fetchByokModels({ apiFormat: draft.apiFormat, baseUrl, apiKey }, fetch, { signal: req.signal }), { headers });
}
