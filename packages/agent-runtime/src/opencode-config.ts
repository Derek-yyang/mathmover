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

import { API_FORMATS, resolveApiFormat, type ApiFormat } from './api-format.ts';

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
  /** Protocol base URL, including its version prefix (not the request path). */
  baseUrl: string;
  apiFormat?: ApiFormat;
  /** 用户填的模型名。 */
  model: string;
  /** 密钥本体；空串 = 本地端点不需要（配置里就不写 apiKey 项）。 */
  apiKey: string;
  /**
   * 用户自填的推理档位清单（设置里那一栏）。空/不传 = 不提供档位。
   *
   * 自造 provider 在 OpenCode 的模型目录里没有条目，所以它**认不出任何 variant**——
   * `--variant high` 会被静默忽略（实测）。真正的通道是在这里**声明 variants**：
   * 每一项 `{ reasoningEffort: <值> }` 会被 provider 的 request 转换器并进请求体
   * （实测端点收到 `reasoning_effort: "high"`）。这也正是 OpenCode 自己对
   * `reasoning_options` 的做法。
   */
  reasoningLevels?: string[];
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

/**
 * 可选档位词汇表 —— 取自 **opencode 自己的档位集合**，不是我们编的。
 * 二进制里它的定义是 `["none","minimal",...["low","medium","high"],"xhigh"]`，
 * provider options 的枚举则是 `low|medium|high|xhigh|max`。
 */
export const REASONING_LEVEL_VOCABULARY = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

/**
 * 默认档位 —— **与 opencode 自己的默认一致**：它内部 `let Z = [...u]` 里
 * `u = ["low","medium","high"]`。所以这个默认值有出处，不是我们拍的。
 */
export const DEFAULT_REASONING_LEVELS = ['low', 'medium', 'high'] as const;

/**
 * 生效的档位清单：存的是逗号串，**空 = 用默认三个**（不是"没有档位"）。
 * 想表示"不要推理档位"，用词汇表里的 `none` 这个值——它本身就是一个真值。
 */
export function effectiveReasoningLevels(stored: string | undefined): string[] {
  // 收 undefined：老配置、或桩数据里根本没这个字段时都得活（实测这一条炸过整个设置卡）
  const saved = normalizeReasoningLevels((stored ?? '').split(','));
  if (!saved.length) return [...DEFAULT_REASONING_LEVELS];
  // 按**词汇表顺序**排：点阵的顺序不该取决于点击先后（用户先点 high 再点 low，
  // 圆点却变成 high 在左，看着像坏了）。词表外的值（老配置/自填）原序接在后面。
  const inVocab = REASONING_LEVEL_VOCABULARY.filter(value => saved.includes(value));
  return [...inVocab, ...saved.filter(value => !(REASONING_LEVEL_VOCABULARY as readonly string[]).includes(value))];
}

/**
 * 哪些**接口格式**有「推理档位」这个方言，以及它的建议值。
 *
 * 档位不是通用概念，是各家私有的方言——同一个 `--variant`，OpenCode 的 provider
 * 转换器会把它映射成不同形状，**映射不出来的直接丢掉**（2026-10-18 逐格式实测）：
 *
 * | 格式 | 请求路径 | `reasoningEffort` 变成 |
 * |---|---|---|
 * | openai-chat | `/chat/completions` | `reasoning_effort: "<值>"` |
 * | openai-responses | `/responses` | `reasoning: { effort: "<值>" }` |
 * | anthropic | `/messages` | **丢掉**（那边是 `thinking.budget_tokens`） |
 * | gemini | `:streamGenerateContent` | **丢掉**（那边是 `thinkingConfig.thinkingBudget`） |
 *
 * 所以：**没有条目的格式就不该给档位控件**——给一个点了没反应的控件是骗人。
 * 条目里的 `suggestions` 是**服务商文档里写着的值**，不是我们自造的档位表；
 * 用户仍可加自己的值（"任意 OpenAI 兼容端点"口径太宽，不能假装确定）。
 */
export const REASONING_DIALECTS: Partial<Record<ApiFormat, { field: string; suggestions: readonly string[] }>> = {
  'openai-chat': { field: 'reasoning_effort', suggestions: ['minimal', 'low', 'medium', 'high'] },
  'openai-responses': { field: 'reasoning.effort', suggestions: ['minimal', 'low', 'medium', 'high'] },
};

/** 该格式的档位方言；`undefined` = 这个格式没有档位可配（UI 据此收起控件）。 */
export function reasoningDialect(apiFormat: ApiFormat | undefined): { field: string; suggestions: readonly string[] } | undefined {
  return REASONING_DIALECTS[resolveApiFormat(apiFormat)];
}

/**
 * 档位值清洗：去空白、去重、只留能当 variant 名的短 token（字母数字开头，含 `._-`）。
 * 值会被当成 JSON 键与命令行参数用，形状必须收窄。
 */
export function normalizeReasoningLevels(levels: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const raw of levels ?? []) {
    const value = String(raw ?? '').trim();
    if (!value || value.length > 32) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) continue;
    seen.add(value);
  }
  return [...seen];
}

function providerEntry(input: OpenCodeProviderInput): Record<string, unknown> | null {
  const baseUrl = (input.baseUrl ?? '').trim().replace(/\/+$/, '');
  const model = (input.model ?? '').trim();
  if (!baseUrl || !model) return null;
  const apiKey = (input.apiKey ?? '').trim();
  const apiFormat = resolveApiFormat(input.apiFormat);
  const levels = normalizeReasoningLevels(input.reasoningLevels);
  return {
    [OPENCODE_BYOK_PROVIDER_ID]: {
      name: 'MathMover',
      npm: API_FORMATS.find(format => format.id === apiFormat)!.npm,
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
          // 档位：每一项声明成一个 variant，`--variant <值>` 时并进请求体（见类型注释）
          ...(levels.length
            ? { variants: Object.fromEntries(levels.map((level) => [level, { reasoningEffort: level }])) }
            : {}),
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
