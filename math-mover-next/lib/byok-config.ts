/**
 * BYOK 内置构造 Agent 的端点配置 —— 只存浏览器 localStorage。
 *
 * 密钥保管的边界（产品裁决）：key 不落服务端磁盘、不进数据库；发送时随请求
 * 经回环传给本机服务，用完即弃。这是「密钥归 agent 配置」原则在内置通路上的
 * 对应形态——配置归用户自己的浏览器。
 */

export interface ByokConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const STORAGE_KEY = 'mm.byok';

export function loadByokConfig(): ByokConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { baseUrl: '', apiKey: '', model: '' };
    const parsed = JSON.parse(raw) as Partial<ByokConfig>;
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
    };
  } catch {
    return { baseUrl: '', apiKey: '', model: '' };
  }
}

export function saveByokConfig(config: ByokConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* 隐私模式等存不了：本次会话内仍可用 */ }
}

export function isByokConfigured(config: ByokConfig): boolean {
  return /^https?:\/\//i.test(config.baseUrl.trim()) && !!config.model.trim();
}
