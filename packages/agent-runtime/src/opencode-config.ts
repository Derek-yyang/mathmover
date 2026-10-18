/**
 * 内置 Agent（OpenCode）的运行时配置组装 —— `OPENCODE_CONFIG_CONTENT`。
 *
 * OpenCode 从多个来源合并配置（全局 `~/.config/opencode/opencode.json`、项目
 * `opencode.json`、以及**环境变量 `OPENCODE_CONFIG_CONTENT` 里的 inline JSON**）。
 * 用环境变量这条：不必写用户的全局配置、也不留临时文件（崩溃后不会残留）。
 *
 * 两块内容：
 *  1. **provider**：把 MathMover 设置里的 BYOK 端点翻译成一个自定义 provider
 *     （`mathmover-byok/<模型>`）。密钥不落这份 JSON，走 `{env:MATHMOVER_BYOK_API_KEY}`
 *     引用——配置内容会作为子进程环境存在，明文写进去等于多一处泄漏面。
 *  2. **mcp**：把我们的 MCP stdio 入口挂进去（`mathmover` server），工具在流里
 *     显示为 `mathmover_<工具名>`（2026-10-18 实测）。
 *
 * 外加一条**收敛**：`permission.bash = 'deny'`——本产品只需要画布工具与文件读写，
 * 不该让内置 agent 在用户机器上跑命令（与 claude 的 `--restricted`、codex 的
 * `sandbox_mode="read-only"` 同一条姿态）。实测这条 deny **不是**摆设：模型连
 * bash 工具都看不到；而且它**不会被** `--dangerously-skip-permissions` 绕过
 * （那条只管「没人应答的询问」，管不到显式拒绝）。
 *
 * ⚠ 「什么都没有时不要设成空/null」：把 `OPENCODE_CONFIG_CONTENT` 设成空对象会
 * **覆盖**用户自己的全局配置。本模块因此在没有内容可写时返回 null，由调用方
 * 决定不动这个环境变量。
 */

/** 自定义 provider 的 id（模型下发给 CLI 时形如 `mathmover-byok/<模型>`）。 */
export const OPENCODE_BYOK_PROVIDER_ID = 'mathmover-byok';

/** 密钥经此环境变量传给子进程，配置里用 `{env:…}` 引用。 */
export const OPENCODE_BYOK_API_KEY_ENV = 'MATHMOVER_BYOK_API_KEY';

/**
 * 一律拒掉的工具。只列 `bash`：它是唯一能让 agent 在用户机器上执行命令、
 * 且我们的构造流程完全不需要的能力。
 */
const DENIED_TOOLS = ['bash'] as const;

/**
 * 上下文/输出上限：只喂给 OpenCode 做预算用，不是对端点的断言。
 * BYOK 端点五花八门、无法枚举真实限制——给一个宽裕值，超限由端点自己报错。
 */
const CONTEXT_TOKEN_LIMIT = 200_000;
const OUTPUT_TOKEN_LIMIT = 8_192;

export interface OpenCodeProviderInput {
  /** OpenAI 兼容端点根（形如 https://api.example.com/v1）。 */
  baseUrl: string;
  /** 用户填的模型名。 */
  model: string;
  /** 密钥本体；空串 = 本地端点不需要（配置里就不写 apiKey 项）。 */
  apiKey: string;
}

export interface OpenCodeMcpInput {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface OpenCodeConfigInput {
  provider?: OpenCodeProviderInput | null;
  mcp?: OpenCodeMcpInput | null;
}

/**
 * 把用户填的模型名翻成 OpenCode 要的 `provider/model` 形式。
 * 已经带了 provider 前缀就不重复加（用户可能自己填全了）。
 */
export function opencodeModelId(model: string): string {
  const raw = (model ?? '').trim();
  if (!raw) return '';
  return raw.startsWith(`${OPENCODE_BYOK_PROVIDER_ID}/`)
    ? raw
    : `${OPENCODE_BYOK_PROVIDER_ID}/${raw}`;
}

function providerEntry(input: OpenCodeProviderInput): Record<string, unknown> | null {
  const baseUrl = (input.baseUrl ?? '').trim().replace(/\/+$/, '');
  const model = (input.model ?? '').trim();
  if (!baseUrl || !model) return null;
  const apiKey = (input.apiKey ?? '').trim();
  return {
    [OPENCODE_BYOK_PROVIDER_ID]: {
      name: 'MathMover',
      // 我们的端点是 OpenAI 兼容的 /chat/completions（原 BYOK 循环也只走这条）。
      npm: '@ai-sdk/openai-compatible',
      options: {
        baseURL: baseUrl,
        ...(apiKey ? { apiKey: `{env:${OPENCODE_BYOK_API_KEY_ENV}}` } : {}),
      },
      models: {
        [model]: {
          name: model,
          // 声明收图，让附件能转发到端点（端点认不认是端点的事，不在这里判死）。
          modalities: { input: ['text', 'image'], output: ['text'] },
          limit: { context: CONTEXT_TOKEN_LIMIT, output: OUTPUT_TOKEN_LIMIT },
        },
      },
    },
  };
}

function mcpEntry(input: OpenCodeMcpInput): Record<string, unknown> | null {
  const command = (input.command ?? '').trim();
  if (!command) return null;
  const environment = input.env && Object.keys(input.env).length > 0
    ? { environment: { ...input.env } }
    : {};
  return {
    mathmover: {
      type: 'local',
      command: [command, ...(input.args ?? [])],
      ...environment,
      enabled: true,
    },
  };
}

/**
 * 组装 `OPENCODE_CONFIG_CONTENT`。
 *
 * provider 与 mcp 都组不出来时返回 **null**——那种情况下一份只剩 `permission`
 * 的配置不值得去动子进程环境（调用方保持该变量不变；设成空对象反而会覆盖用户
 * 自己的全局配置）。正常形态里 mcp 恒有，所以实际总是返回内容。
 */
export function buildOpenCodeConfigContent(input: OpenCodeConfigInput): string | null {
  const provider = input.provider ? providerEntry(input.provider) : null;
  const mcp = input.mcp ? mcpEntry(input.mcp) : null;
  if (!provider && !mcp) return null;
  return JSON.stringify({
    ...(provider ? { provider } : {}),
    ...(mcp ? { mcp } : {}),
    // 收紧随内容一起下发（见文件头：本产品不需要 bash）。
    permission: Object.fromEntries(DENIED_TOOLS.map((tool) => [tool, 'deny'])),
  });
}
