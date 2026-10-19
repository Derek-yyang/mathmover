import { API_FORMATS, resolveApiFormat } from '../../packages/agent-runtime/src/api-format.ts';
import type { ByokConfig } from './byok-store';
import type { ByokModel } from './byok-config';

export type ByokProbeResult = {
  ok: boolean;
  status: 'ready' | 'not-logged-in' | 'broken' | 'unverified';
  message: string;
};

export type ByokModelsResult = ByokProbeResult & { models?: ByokModel[] };

/** Shared model-list transport; credentials and upstream error bodies never leave the server. */
export async function fetchByokModels(
  config: Pick<ByokConfig, 'apiFormat' | 'baseUrl' | 'apiKey'>,
  request: typeof fetch = fetch,
  options: { signal?: AbortSignal; allPages?: boolean } = {},
): Promise<ByokModelsResult> {
  const apiFormat = resolveApiFormat(config.apiFormat);
  const label = API_FORMATS.find(format => format.id === apiFormat)!.label;
  const base = config.baseUrl.trim().replace(/\/+$/, '');
  const key = config.apiKey.trim();
  const headers: Record<string, string> = {};
  if (apiFormat === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (key) headers['x-api-key'] = key;
  } else if (apiFormat === 'gemini') {
    if (key) headers['x-goog-api-key'] = key;
  } else if (key) headers.authorization = `Bearer ${key}`;

  try {
    const timeout = AbortSignal.timeout(8_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const url = new URL(`${base}/models`);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid endpoint');
    const found = new Map<string, ByokModel>();
    const cursors = new Set<string>();
    while (true) {
      const res = await request(url.href, { headers, signal, cache: 'no-store', redirect: 'error' });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, status: 'not-logged-in', message: `${label}：密钥未授权，请检查密钥及接口格式。` };
      }
      if (res.status === 404 || res.status === 405) {
        return { ok: false, status: 'unverified', message: `${label}：该端点未开放模型列表，请核对基础地址与服务商文档，或手动输入模型 ID。` };
      }
      if (!res.ok) return { ok: false, status: 'broken', message: `${label}：端点返回 HTTP ${res.status}。` };
      const data = await res.json().catch(() => null);
      const entries = apiFormat === 'gemini' ? data?.models : data?.data;
      if (!Array.isArray(entries)) {
        return { ok: false, status: 'unverified', message: `${label}：响应不是预期的模型列表，请检查接口格式与基础地址。` };
      }
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const rawId = apiFormat === 'gemini' ? entry.name : entry.id;
        if (typeof rawId !== 'string' || !rawId.trim()) continue;
        const id = apiFormat === 'gemini' ? rawId.trim().replace(/^models\//, '') : rawId.trim();
        if (!id) continue;
        const display = apiFormat === 'gemini' ? entry.displayName : entry.display_name;
        found.set(id, { id, label: typeof display === 'string' && display.trim() ? display.trim() : id });
      }
      const cursor = options.allPages === false ? undefined
        : apiFormat === 'gemini' ? data.nextPageToken
        : apiFormat === 'anthropic' && data.has_more ? data.last_id : undefined;
      if (!cursor && !(options.allPages !== false && apiFormat === 'anthropic' && data.has_more)) break;
      if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) {
        return { ok: false, status: 'unverified', message: `${label}：模型列表分页响应异常，请重试或手动输入模型 ID。` };
      }
      cursors.add(cursor);
      url.searchParams.set(apiFormat === 'gemini' ? 'pageToken' : 'after_id', cursor);
    }
    return { ok: true, status: 'ready', models: [...found.values()], message: `${label}：模型列表可读取；生成与工具调用能力以实际使用为准。` };
  } catch {
    return { ok: false, status: 'broken', message: `${label}：无法连接端点或请求超时，请检查地址与网络。` };
  }
}

/** A non-generating probe of the saved protocol, without fetching subsequent pages. */
export async function probeByokConfig(config: ByokConfig, request: typeof fetch = fetch): Promise<ByokProbeResult> {
  const { ok, status, message } = await fetchByokModels(config, request, { allPages: false });
  return { ok, status, message };
}
