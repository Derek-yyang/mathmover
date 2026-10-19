/** Shared, browser-safe API formats. No SDKs or credentials belong here. */
export const API_FORMATS = [
  { id: 'openai-chat', label: 'OpenAI Chat Completions', npm: '@ai-sdk/openai-compatible', placeholder: 'https://api.example.com/v1' },
  { id: 'openai-responses', label: 'OpenAI Responses', npm: '@ai-sdk/openai', placeholder: 'https://api.openai.com/v1' },
  { id: 'anthropic', label: 'Anthropic Messages', npm: '@ai-sdk/anthropic', placeholder: 'https://api.anthropic.com/v1' },
  { id: 'gemini', label: 'Gemini Native', npm: '@ai-sdk/google', placeholder: 'https://generativelanguage.googleapis.com/v1beta' },
] as const;

export type ApiFormat = typeof API_FORMATS[number]['id'];
export const DEFAULT_API_FORMAT: ApiFormat = 'openai-chat';

export function isApiFormat(value: unknown): value is ApiFormat {
  return API_FORMATS.some(format => format.id === value);
}

/** Only missing legacy values default; unknown formats must never silently downgrade. */
export function resolveApiFormat(value: unknown): ApiFormat {
  if (value === undefined) return DEFAULT_API_FORMAT;
  if (isApiFormat(value)) return value;
  throw new Error('不支持的 API 接口格式');
}
