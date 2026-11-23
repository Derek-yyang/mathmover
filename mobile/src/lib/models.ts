import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { ModelProtocol } from './store';

export interface ModelOption {
  id: string;
  label?: string;
}

function detailOf(data: unknown): string {
  if (typeof data === 'string') return data.slice(0, 200);
  if (data && typeof data === 'object') {
    const error = (data as { error?: unknown }).error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
    try {
      return JSON.stringify(data).slice(0, 200);
    } catch {
      return '';
    }
  }
  return '';
}

/** 拉取供应商的模型列表；原生走 CapacitorHttp，Web 开发走 fetch。 */
export async function fetchModels(
  protocol: ModelProtocol,
  baseURL: string,
  apiKey: string,
): Promise<ModelOption[]> {
  const base = baseURL.trim().replace(/\/+$/, '');
  const url = `${base}/models`;
  const headers: Record<string, string> = {};
  if (protocol === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (protocol === 'google') {
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }

  let status: number;
  let data: unknown;

  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: 15_000,
      readTimeout: 15_000,
    });
    status = response.status;
    data = response.data;
  } else {
    const response = await fetch(url, { method: 'GET', headers });
    status = response.status;
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (status < 200 || status >= 300) {
    const detail = detailOf(data);
    throw new Error(`获取模型列表失败（${status}）${detail ? `：${detail}` : ''}`);
  }

  const raw =
    protocol === 'google'
      ? (data as { models?: unknown })?.models
      : Array.isArray(data)
        ? data
        : (data as { data?: unknown })?.data;
  if (!Array.isArray(raw)) throw new Error('模型列表格式无法识别');

  const seen = new Set<string>();
  const options: ModelOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (protocol === 'google') {
      const methods = record.supportedGenerationMethods;
      if (Array.isArray(methods) && !methods.includes('generateContent')) continue;
      const id = String(record.name ?? '').replace(/^models\//, '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      options.push({
        id,
        label: typeof record.displayName === 'string' ? record.displayName : undefined,
      });
      continue;
    }

    const id = typeof record.id === 'string' ? record.id : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label =
      typeof record.display_name === 'string'
        ? record.display_name
        : typeof record.displayName === 'string'
          ? record.displayName
          : undefined;
    options.push({ id, label });
  }

  return options;
}
