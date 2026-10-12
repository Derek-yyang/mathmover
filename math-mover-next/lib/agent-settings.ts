import type { RuntimeOption } from '../components/dashboard/AgentChatPanel';

export interface AgentGuide {
  docsUrl: string;
  installUrl: string;
  configure: string;
}

const guides: Record<string, AgentGuide> = {
  'claude-code': {
    docsUrl: 'https://code.claude.com/docs/en/setup',
    installUrl: 'https://www.npmjs.com/package/@anthropic-ai/claude-code',
    configure: '在终端打开 Claude Code，按其指引登录或配置模型服务。MathMover 沿用该 Agent 的配置。',
  },
  codex: {
    docsUrl: 'https://developers.openai.com/codex/cli/',
    installUrl: 'https://github.com/openai/codex',
    configure: '在终端打开 Codex，完成登录或模型服务配置。模型与账号由 Codex 自身管理。',
  },
  dsh: {
    docsUrl: 'https://github.com/deepseek-ai/deepseek-harness#run',
    installUrl: 'https://github.com/deepseek-ai/deepseek-harness',
    configure: '按 DeepSeek Harness 官方文档配置模型服务与凭据。MathMover 不代管其模型或密钥。',
  },
};

/** 安装向导的四步引导（对齐 OpenDesign 的 agentInstall steps）。 */
export const INSTALL_STEPS = [
  '点「安装」打开官方安装页，装好该 Agent 的命令行程序。',
  '在终端打开该 Agent，完成登录或模型凭据配置。',
  '回到这里点「刷新检测」。',
  '列表出现该 Agent 后点「使用」选中它。',
] as const;

/** 装了却探测不到时的排错提示（PATH 继承 + *_BIN 显式覆盖）。 */
export const INSTALL_PATH_HINT =
  '用 npm / Homebrew 装过但仍显示未安装：检查该工具的 bin 目录是否在 MathMover 服务继承的 PATH 里'
  + '（终端与桌面应用的 PATH 可能不同）。也可以设环境变量直接指向可执行文件'
  + '（CLAUDE_BIN / CODEX_BIN / DSH_BIN）再重启服务——指向哪个就用哪个，指错会如实显示不可用，不会静默换别的二进制。';

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
