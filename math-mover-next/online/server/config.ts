import { normalizeOnlineModelConfig, type OnlineModelConfig } from '../model-config';

/** Deployment-owned default. Visitor-owned BYOK is resolved separately per run. */
export function onlineConfig(): OnlineModelConfig & { ready: boolean } {
  const apiKey = process.env.MATHMOVER_ONLINE_API_KEY?.trim() ?? '';
  const baseUrl = process.env.MATHMOVER_ONLINE_BASE_URL?.trim() ?? '';
  const model = process.env.MATHMOVER_ONLINE_MODEL?.trim() ?? '';
  const raw = { apiKey, baseUrl, model, apiFormat: process.env.MATHMOVER_ONLINE_API_FORMAT };
  if (!apiKey || !baseUrl || !model) return { apiKey, baseUrl, model, apiFormat: 'openai-chat', ready: false };
  const config = normalizeOnlineModelConfig(raw);
  return { ...config, ready: true };
}
export function resolveRunConfig(provider: unknown): OnlineModelConfig {
  if (provider === undefined) {
    const config = onlineConfig();
    if (!config.ready) throw new Error('在线体验尚未配置模型服务。');
    return config;
  }
  return normalizeOnlineModelConfig(provider);
}
export function publicConfig() {
  const { ready, model } = onlineConfig();
  return { ready, runtimes: [{ id: 'opencode', name: '内置 Agent', version: '1.19.3', usable: ready,
    canAttachImages: true, authStatus: ready ? 'ok' : 'missing',
    authMessage: ready ? undefined : '默认模型服务未配置，可使用自己的模型。',
    models: { list: [{ id: 'default', label: model || '默认模型' }], source: 'live' } }],
    supportsCustomModel: true, defaultModelLabel: model || '默认模型' };
}
