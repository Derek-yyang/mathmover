import type { RuntimeOption } from '../components/dashboard/AgentChatPanel';

export interface AgentGuide {
  docsUrl: string;
  configure: string;
}

const guides: Record<string, AgentGuide> = {
  'claude-code': {
    docsUrl: 'https://code.claude.com/docs/en/setup',
    configure: '在终端打开 Claude Code，按其指引登录或配置模型服务。MathMover 沿用该 Agent 的配置。',
  },
  codex: {
    docsUrl: 'https://developers.openai.com/codex/cli/',
    configure: '在终端打开 Codex，完成登录或模型服务配置。模型与账号由 Codex 自身管理。',
  },
  dsh: {
    docsUrl: 'https://github.com/deepseek-ai/deepseek-harness#run',
    configure: '按 DeepSeek Harness 官方文档配置模型服务与凭据。MathMover 不代管其模型或密钥。',
  },
};

export function agentGuide(id: string): AgentGuide | undefined {
  return Object.hasOwn(guides, id) ? guides[id] : undefined;
}

// Keep an unavailable current choice visible, without treating it as usable or
// silently replacing it. All grouping is derived from the shared runtime state.
export function groupAgents(runtimes: RuntimeOption[], activeRuntimeId?: string) {
  const current = runtimes.find(runtime => runtime.id === activeRuntimeId);
  return {
    detected: runtimes.filter(runtime => runtime.usable),
    unavailable: runtimes.filter(runtime => !runtime.usable && runtime.id !== activeRuntimeId),
    currentUnavailable: current && !current.usable ? current : undefined,
    missingSelection: activeRuntimeId && !current ? activeRuntimeId : undefined,
  };
}
