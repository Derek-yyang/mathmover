import { API_FORMATS, resolveApiFormat, type ApiFormat } from '../../packages/agent-runtime/src/api-format.ts';
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
    // OpenCode publishes its shared catalog outside the OpenAI inference prefix.
    // Rewrite discovery only; the saved base URL still belongs to generation.
    if ((apiFormat === 'openai-chat' || apiFormat === 'openai-responses')
      && url.origin === 'https://opencode.ai' && url.pathname === '/inference/openai/v1/models') {
      url.pathname = '/inference/v1/models';
    }
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

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nonempty = (value: unknown) => typeof value === 'string' && !!value.trim();
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Classify upstream failures without exposing their bodies, URLs or credentials. */
function invocationFailure(label: string, status: number, data: unknown): ByokProbeResult {
  const error = record(record(data).error);
  const details = [error.code, error.type, error.status, error.message].filter(value => typeof value === 'string').join(' ');
  let message: string;
  let state: ByokProbeResult['status'] = 'broken';
  if (status === 401 || /invalid[_ -]?(api[_ -]?)?key|invalid credential|authentication_error/i.test(details)) {
    state = 'not-logged-in'; message = '密钥无效或已失效，请检查并重新保存。';
  } else if (status === 402 || /insufficient[_ -]?(quota|funds|balance|credits)|credit balance|billing_hard_limit/i.test(details)) {
    message = '服务商返回余额或配额不足，请检查账户及上游服务额度。';
  } else if (status === 403 || /permission_denied|permission_error/i.test(details)) {
    state = 'not-logged-in'; message = '调用被拒绝，请检查密钥的模型权限及服务商访问限制。';
  } else if (status === 429 || /rate_limit/i.test(details)) {
    message = '请求受到限流，请稍后再试。';
  } else if (status === 404 || status === 405 || /model_not_found|not_found_error/i.test(details)) {
    state = 'unverified'; message = '模型或调用地址不存在，请检查模型 ID、基础地址与接口格式。';
  } else if (status === 400 || status === 422) {
    state = 'unverified'; message = '测试请求被拒绝，请检查接口格式及模型所需参数。';
  } else {
    message = status >= 400 ? `模型服务返回 HTTP ${status}，请稍后重试或检查服务商状态。` : '模型服务返回错误，未能完成测试调用。';
  }
  return { ok: false, status: state, message: `${label}：${message}` };
}

/** A valid text reply proves generation; a token-limited reasoning reply also proves invocation. */
function invocationReply(apiFormat: ApiFormat, data: Record<string, unknown>): { text: boolean; limited: boolean } {
  if (apiFormat === 'openai-chat') {
    const choice = record(Array.isArray(data.choices) ? data.choices[0] : null);
    const message = record(choice.message);
    return {
      text: nonempty(message.content) || (Array.isArray(message.content) && message.content.some(part => nonempty(record(part).text))),
      limited: choice.finish_reason === 'length' && positive(record(data.usage).completion_tokens),
    };
  }
  if (apiFormat === 'openai-responses') {
    if (data.status === 'failed' || data.status === 'cancelled' || data.status === 'in_progress' || data.status === 'queued') return { text: false, limited: false };
    return {
      text: Array.isArray(data.output) && data.output.some(item => {
        const message = record(item);
        return message.type === 'message' && Array.isArray(message.content)
          && message.content.some(part => record(part).type === 'output_text' && nonempty(record(part).text));
      }),
      limited: data.status === 'incomplete' && record(data.incomplete_details).reason === 'max_output_tokens'
        && positive(record(data.usage).output_tokens),
    };
  }
  if (apiFormat === 'anthropic') return {
    text: data.type === 'message' && Array.isArray(data.content)
      && data.content.some(part => record(part).type === 'text' && nonempty(record(part).text)),
    limited: data.type === 'message' && data.stop_reason === 'max_tokens' && positive(record(data.usage).output_tokens),
  };
  const candidate = record(Array.isArray(data.candidates) ? data.candidates[0] : null);
  const parts = record(candidate.content).parts;
  return {
    text: Array.isArray(parts) && parts.some(part => nonempty(record(part).text)),
    limited: candidate.finishReason === 'MAX_TOKENS'
      && (positive(record(data.usageMetadata).candidatesTokenCount) || positive(record(data.usageMetadata).thoughtsTokenCount)),
  };
}

/** One short generation using the saved model. No discovery, retries, tools or configuration writes. */
export async function probeByokConfig(
  config: ByokConfig,
  request: typeof fetch = fetch,
  options: { signal?: AbortSignal } = {},
): Promise<ByokProbeResult> {
  const apiFormat = resolveApiFormat(config.apiFormat);
  const label = API_FORMATS.find(format => format.id === apiFormat)!.label;
  const timeout = AbortSignal.timeout(25_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const base = config.baseUrl.trim().replace(/\/+$/, '');
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return { ok: false, status: 'unverified', message: `${label}：请填写有效的 HTTP(S) 基础地址，无需查询参数。` };
    }
    const model = config.model.trim();
    if (!model) return { ok: false, status: 'unverified', message: `${label}：请先填写并保存模型 ID。` };
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const key = config.apiKey.trim();
    const prompt = 'Reply with exactly OK.';
    // This cap applies only to this disposable test, never to real Agent generation.
    const maxTokens = 128;
    let endpoint: string;
    let body: Record<string, unknown>;
    if (apiFormat === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      if (key) headers['x-api-key'] = key;
      endpoint = `${base}/messages`;
      body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
    } else if (apiFormat === 'gemini') {
      if (key) headers['x-goog-api-key'] = key;
      endpoint = `${base}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`;
      body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } };
    } else {
      if (key) headers.authorization = `Bearer ${key}`;
      endpoint = `${base}/${apiFormat === 'openai-responses' ? 'responses' : 'chat/completions'}`;
      // OpenAI reasoning models reject the legacy Chat Completions token field.
      const tokenField = url.hostname === 'api.openai.com' || /^(?:gpt-5(?:[.\-]|$)|o\d(?:[\-]|$))/i.test(model)
        ? 'max_completion_tokens' : 'max_tokens';
      body = apiFormat === 'openai-responses'
        ? { model, input: prompt, max_output_tokens: maxTokens, stream: false }
        : { model, messages: [{ role: 'user', content: prompt }], [tokenField]: maxTokens, stream: false };
    }
    signal.throwIfAborted();
    const response = await request(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal, cache: 'no-store', redirect: 'error' });
    const data: unknown = await response.json().catch(() => null);
    signal.throwIfAborted();
    if (!response.ok || record(data).error) return invocationFailure(label, response.status, data);
    const reply = invocationReply(apiFormat, record(data));
    if (reply.text || reply.limited) return {
      ok: true, status: 'ready',
      message: `${label}：${reply.text ? '模型调用成功。' : '模型已响应，简短测试的输出达到长度上限。'}此测试未验证工具调用能力。`,
    };
    return { ok: false, status: 'unverified', message: `${label}：未收到有效的模型回复，请检查模型、接口格式及服务商限制。` };
  } catch {
    const message = options.signal?.aborted ? '测试已取消。'
      : timeout.aborted ? '模型调用超时，请稍后重试。' : '无法完成模型调用，请检查地址与网络。';
    return { ok: false, status: 'broken', message: `${label}：${message}` };
  }
}
