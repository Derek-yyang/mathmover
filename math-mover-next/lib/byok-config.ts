/**
 * BYOK 配置的浏览器端客户端 —— 只接触**掩码视图**。
 *
 * 密钥保管在应用数据目录（byok-store.ts，对齐 OpenDesign 的桌面化模型）：
 * 完整 key 不回传浏览器，界面只拿 apiKeyConfigured + 尾 4 位；保存时 key
 * 传空 = 保留原 key（改端点/模型不必重填）。
 */

export interface ByokConfigView {
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeyTail: string;
}

export async function fetchByokConfig(): Promise<ByokConfigView> {
  const res = await fetch('/api/byok');
  if (!res.ok) throw new Error(`读取 BYOK 配置失败（HTTP ${res.status}）`);
  return res.json();
}

export async function saveByokConfig(input: {
  baseUrl: string;
  model: string;
  /** 空 = 保留已存的 key */
  apiKey?: string;
}): Promise<ByokConfigView> {
  const res = await fetch('/api/byok', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`保存 BYOK 配置失败（HTTP ${res.status}）`);
  return res.json();
}
