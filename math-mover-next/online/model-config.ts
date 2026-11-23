export const ONLINE_API_FORMATS = [
  { id: 'openai-chat', label: 'OpenAI Chat Completions' },
  { id: 'openai-responses', label: 'OpenAI Responses' },
  { id: 'anthropic', label: 'Anthropic Messages' },
  { id: 'gemini', label: 'Gemini Native' },
] as const;

export type OnlineApiFormat = typeof ONLINE_API_FORMATS[number]['id'];

export interface OnlineModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat: OnlineApiFormat;
}

export const ONLINE_REASONING_EFFORTS = [
  { id: 'low', label: 'low', default: true },
] as const;

export type OnlineReasoningEffort = typeof ONLINE_REASONING_EFFORTS[number]['id'];

/** The hosted experience has one stable mode; ignore any stale or hand-crafted client override. */
export function normalizeOnlineReasoningEffort(_value?: unknown): OnlineReasoningEffort {
  return 'low';
}

const FORMATS = new Set<OnlineApiFormat>(ONLINE_API_FORMATS.map(format => format.id));

function formatFrom(value: unknown): OnlineApiFormat {
  if (value === undefined || value === '') return 'openai-chat';
  if (typeof value === 'string' && FORMATS.has(value as OnlineApiFormat)) return value as OnlineApiFormat;
  throw new Error('不支持该 API 格式。');
}

function privateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (!host.includes('.') && !host.includes(':')) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some(value => value > 255)) return true;
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19));
  }
  return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') ||
    host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb');
}

/** Validate user-owned provider input. Credentials stay in request/process memory. */
export function normalizeOnlineModelConfig(value: unknown): OnlineModelConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('自定义模型配置无效。');
  const input = value as Record<string, unknown>;
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : '';
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  const apiFormat = formatFrom(input.apiFormat);
  if (!baseUrl || baseUrl.length > 2048 || !apiKey || apiKey.length > 8192 || !model || model.length > 200) {
    throw new Error('请完整填写 API 地址、模型 ID 和 API Key。');
  }
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new Error('API 地址格式无效。'); }
  if (url.protocol !== 'https:' || url.username || url.password || privateHostname(url.hostname)) {
    throw new Error('API 地址必须是公开的 HTTPS 地址。');
  }
  if (/[\u0000-\u001f\u007f]/.test(model) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(apiKey)) {
    throw new Error('模型配置包含不支持的字符。');
  }
  return { baseUrl: url.toString().replace(/\/$/, ''), apiKey, model, apiFormat };
}
