/**
 * BYOK 配置的浏览器端客户端 —— 只接触**掩码视图**。
 *
 * 密钥保管在应用数据目录（byok-store.ts，对齐 OpenDesign 的桌面化模型）：
 * 完整 key 不回传浏览器，界面只拿 apiKeyConfigured + 尾 4 位；保存时 key
 * 传空仅在同源端点保留原 key；null 表示不使用密钥。
 */

import { resolveApiFormat, type ApiFormat } from '../../packages/agent-runtime/src/api-format.ts';
import type { ByokConfigView } from './byok-store';
import type { RuntimeOption } from '../components/dashboard/AgentChatPanel';

export { API_FORMATS, DEFAULT_API_FORMAT, isApiFormat, type ApiFormat } from '../../packages/agent-runtime/src/api-format.ts';

// 掩码视图的唯一定义在服务端仓（maskByokConfig 生产它）；这里只转发类型。
export type { ByokConfigView };

export interface ByokModel { id: string; label: string }

/** A blank key may reuse a same-origin saved credential; null explicitly disables authentication. */
export async function fetchByokModelList(input: { apiFormat: ApiFormat; baseUrl: string; apiKey: string | null }, signal: AbortSignal): Promise<ByokModel[]> {
  const res = await fetch('/api/byok/models', {
    method: 'POST', signal, cache: 'no-store',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  const data = await res.json() as { ok?: boolean; models?: ByokModel[]; message?: string; error?: string };
  if (!res.ok || data.ok !== true || !Array.isArray(data.models)) {
    throw new Error(data.message ?? data.error ?? `获取模型列表失败（HTTP ${res.status}）`);
  }
  return data.models;
}

/**
 * 一次性迁移清理：localStorage 时代（密钥迁入应用数据目录之前）的 `mm.byok`
 * 残键可能含完整 key 本体——进工作台即清除，不等设置页打开。
 */
export function purgeLegacyByokKey(): void {
  try {
    localStorage.removeItem('mm.byok');
  } catch { /* 隐私模式等读不了 localStorage：跳过 */ }
}

export async function fetchByokConfig(): Promise<ByokConfigView> {
  const res = await fetch('/api/byok');
  if (!res.ok) throw new Error(`读取 BYOK 配置失败（HTTP ${res.status}）`);
  const view = await res.json() as ByokConfigView;
  return { ...view, apiFormat: resolveApiFormat(view.apiFormat) };
}

export async function saveByokConfig(input: {
  baseUrl: string;
  model: string;
  apiFormat?: ApiFormat;
  /** 推理档位清单（逗号分隔）。不传 = 保留原值。 */
  reasoningLevels?: string;
  /** 空 = 同源时保留已存的 key；null = 不使用密钥 */
  apiKey?: string | null;
}): Promise<ByokConfigView & { runtime: RuntimeOption }> {
  const res = await fetch('/api/byok', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(error?.error ?? `保存 BYOK 配置失败（HTTP ${res.status}）`);
  }
  const view = await res.json() as ByokConfigView & { runtime: RuntimeOption };
  return { ...view, apiFormat: resolveApiFormat(view.apiFormat) };
}
