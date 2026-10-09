export type ApiProtocol = 'openai_chat' | 'openai_responses' | 'anthropic';
export interface RoutingConfig {
  api_protocol: ApiProtocol;
  base_url: string;
  model_name: string;
  router_mode: 'llm' | 'decisions';
  decisions_threshold: string;
  decisions_model: string;
  api_key_masked: string;
  perplexity_api_key_masked: string;
}

export function readRoutingConfig(data: unknown): RoutingConfig {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid config');
  const cfg = data as Record<string, unknown>;
  if (!['base_url', 'model_name', 'router_mode'].some(key => key in cfg) || 'error' in cfg) throw new Error('Invalid config');
  const str = (key: string, fallback = '') => typeof cfg[key] === 'string' ? cfg[key] as string : fallback;
  return {
    api_protocol: ['openai_chat', 'openai_responses', 'anthropic'].includes(str('api_protocol')) ? str('api_protocol') as ApiProtocol : 'openai_chat',
    base_url: str('base_url'), model_name: str('model_name'),
    router_mode: cfg.router_mode === 'decisions' ? 'decisions' : 'llm',
    decisions_threshold: typeof cfg.decisions_threshold === 'number' ? String(cfg.decisions_threshold) : str('decisions_threshold', '0.8'),
    decisions_model: str('decisions_model'),
    api_key_masked: str('api_key_masked'), perplexity_api_key_masked: str('perplexity_api_key_masked'),
  };
}

const fields = ['api_protocol', 'base_url', 'model_name', 'router_mode', 'decisions_threshold', 'decisions_model'] as const;

export function routingChanges(baseline: RoutingConfig | null, draft: RoutingConfig | null, apiKey = '', decisionsKey = ''): Record<string, string> {
  // 没有成功读取基线时，绝不能构造可提交的空配置。
  if (!baseline || !draft) return {};
  const body: Record<string, string> = {};
  for (const field of fields) if (draft[field].trim() !== baseline[field].trim()) body[field] = draft[field].trim();
  if (apiKey.trim()) body.api_key = apiKey.trim();
  if (decisionsKey.trim()) body.perplexity_api_key = decisionsKey.trim();
  return body;
}

export function routingValidation(draft: RoutingConfig, apiKey = '', decisionsKey = ''): string | null {
  try {
    const url = new URL(draft.base_url.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch { return '请输入有效的 HTTP / HTTPS API 地址。'; }
  if (!draft.model_name.trim()) return '请输入 LLM 分类模型 ID（决策模式也需要回退模型）。';
  if (!draft.api_key_masked && !apiKey.trim()) return '请输入 LLM 分类模型的 API 密钥。';
  if (draft.router_mode === 'decisions') {
    if (!draft.perplexity_api_key_masked && !decisionsKey.trim()) return '请输入 Perplexity API 密钥。';
    const threshold = Number(draft.decisions_threshold);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) return '置信度阈值必须大于 0 且不超过 1。';
  }
  return null;
}

export function routingSavePayload(baseline: RoutingConfig | null, draft: RoutingConfig | null, apiKey = '', decisionsKey = ''): Record<string, string> {
  const changes = routingChanges(baseline, draft, apiKey, decisionsKey);
  if (!draft || !Object.keys(changes).length) return {};
  // 旧配置端点会将缺省 decisions_model 重置为默认值，保存时须带上已读取值。
  return { ...changes, decisions_model: draft.decisions_model.trim() };
}
