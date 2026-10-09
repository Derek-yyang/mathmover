export interface AgentDiagnostic {
  kind: 'detection' | 'unavailable' | 'authentication' | 'launch' | 'communication' | 'unknown';
  title: string;
  guidance: string;
  detail: string;
  runtimeId?: string;
}

// Diagnostics can contain stderr from third-party CLIs. Redact before keeping
// it in React state, not just when the details drawer is opened.
export function redactAgentError(value: string): string {
  return value.slice(0, 16000)
    .replace(new RegExp(String.fromCharCode(27) + '\\[[0-?]*[ -/]*[@-~]', 'g'), '')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '[认证信息已隐藏]')
    .replace(/(\b(?:[\w-]*(?:api[_-]?key|token|password|secret)|authorization)\s*["']?\s*[:=]\s*)["']?[^\s,"';&}\]]+/gi, '$1[已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[密钥已隐藏]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[认证信息已隐藏]@')
    .slice(0, 4000);
}

export function agentFailure(input: {
  stage: 'detect' | 'request' | 'runtime'; message: string; runtimeId?: string; status?: number;
}): AgentDiagnostic {
  const detail = redactAgentError(input.message || '没有返回具体错误信息。');
  const base = { detail, runtimeId: input.runtimeId };
  if (input.stage === 'detect') return {
    ...base, kind: 'detection', title: '无法完成 Agent 检测',
    guidance: '请确认本机前端服务仍在运行，再重新检测。已有列表和选择会保留；登录状态尚未确认。',
  };
  if (/当前不可用|没有可用的\s*agent\s*cli/i.test(detail)) return {
    ...base, kind: 'unavailable', title: '所选 Agent 当前无法启动',
    guidance: '返回信息未区分未安装和启动失败。请在终端检查该 Agent，再重新检测或查看配置指引。不会自动切换。',
  };
  if (input.stage === 'runtime' && /not logged in|authentication (?:failed|required)|invalid api[_ -]?key|unauthorized|未登录|认证失败|无效.{0,4}密钥/i.test(detail)) return {
    ...base, kind: 'authentication', title: 'Agent 返回了认证错误',
    guidance: '请在对应 Agent 中检查账号或凭据配置。此提示来自错误返回，不是独立的登录检测结果。',
  };
  if (input.stage === 'runtime' && /启动.{0,80}失败|spawn\s+\S+\s+(?:ENOENT|EACCES|EPERM)/i.test(detail)) return {
    ...base, kind: 'launch', title: 'Agent 启动失败',
    guidance: '请确认该 Agent 在终端中可以运行，再检查安装、执行权限或配置。具体原因见错误详情。',
  };
  if (input.stage === 'request' && /failed to fetch|networkerror|load failed|network request failed/i.test(detail)) return {
    ...base, kind: 'communication', title: '与本机 Agent 服务通信失败',
    guidance: '请检查本机前端服务和浏览器连接，再重新检测。暂时不能据此判断 Agent 是否已登录。',
  };
  return {
    ...base, kind: 'unknown', title: input.status ? `Agent 请求失败（HTTP ${input.status}）` : 'Agent 调用失败，原因尚未确认',
    guidance: '请展开错误详情，在对应 Agent 中检查配置。重新检测只检查程序，不会重发这道题或验证模型调用。',
  };
}

export function agentResponseError(body: string): string {
  // The existing route can return either JSON or NDJSON, including for 503s.
  const bounded = body.slice(0, 16000);
  for (const line of [bounded, ...bounded.split('\n')]) {
    try {
      const item = JSON.parse(line);
      const message = item?.message ?? (typeof item?.error === 'string' ? item.error : item?.error?.message);
      if (typeof message === 'string' && message.trim()) return message;
    } catch { /* Do not display an HTML error page or arbitrary response body. */ }
  }
  return '服务未返回可识别的错误说明，具体原因尚未确认。';
}
