/**
 * Agent 运行时定义 —— OpenDesign 的「一个 CLI 一个定义」模式。
 *
 * 契约：任何 agent CLI 都靠这两个函数接入
 *   - buildArgs()   生成命令行参数
 *   - parseLine()   把它自己的输出行归一成 AgentEvent
 * 换 CLI = 加一个定义文件 + 注册一行；**只有遇到全新输出格式才需要写解析器**。
 *
 * ⚠ Claude Code 的 stream-json 事件形状已于 2026-10-09 用真实输出校准
 *   （样本：tests/fixtures/claude-stream-sample.jsonl，抓样脚本 scripts/diag-stream-calibrate.mjs）。
 *   结论：assistant/user 事件按 content 块拆分单发（thinking / tool_use / text 各一条），
 *   但一行多块的多版本兼容仍按数组返回。增量在 stream_event.content_block_delta。
 * ⚠ Codex 的事件形状同日校准（样本 tests/fixtures/codex-stream-sample.jsonl）。
 *   dsh headless 是纯文本单轮（其 README 明示 one-shot、无会话续接）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { formatClaudeStreamJsonInput, type ImageInput } from './images.ts';
import { claudeConfiguredModels } from './claude-env.ts';
import { getCapabilities } from './capabilities.ts';

/** 归一后的事件——前端 useChat 与上层编排都只认这个。 */
export type AgentEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'text-delta'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; name: string; toolCallId: string; input?: unknown }
  | { kind: 'tool-result'; toolCallId: string; output?: unknown; isError?: boolean }
  | { kind: 'thinking'; text: string }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number }
  | { kind: 'done'; resultText?: string; sessionId?: string; status?: 'completed' | 'cancelled' }
  | { kind: 'error'; message: string }
  | { kind: 'raw'; line: string };

/**
 * 模型选项。`id` 是下发给 CLI 的原样值（别名或全名），`label` 只用来看。
 *
 * 对齐 OpenDesign 的 RuntimeModelOption：**不建模模型能力**（没有 vision / reasoning
 * 等能力标志）。模型能不能看图、推理多深，是用户选型的事，不该由代码判死。
 */
export interface RuntimeModelOption {
  id: string;
  label: string;
  /**
   * 该模型支持的推理档位（如 off/low/high/max）。可选——不是所有运行时都有。
   * 这是**运行参数**不是模型能力标志，用户选了就随 execute 帧下发。
   */
  reasoningOptions?: Array<{ id: string; label: string; default?: boolean }>;
}

/**
 * 这份模型清单是「真发现」还是「兜底猜的」。
 *
 * OpenDesign 的关键设计：`fallbackModels` 只是 UI 上的提示，**不是真清单**。
 * 下发前要对 live 清单校验用户的选择，别让 UI 显示了一个跑不了的模型。
 */
export type RuntimeModelSource = 'live' | 'fallback';

/** CLI 自带的 `models` 子命令：跑 args、解析 stdout。 */
export interface RuntimeListModels {
  args: string[];
  timeoutMs?: number;
  parse: (stdout: string) => RuntimeModelOption[] | null;
}

/**
 * formatStdinInput 的附加上下文。只有走 stdin 协议的运行时需要——
 * 例如 dsh 的 `execute` 帧要带 request_id / cwd / model / resume_session_id，
 * 而不只是裸 prompt。
 */
export interface StdinContext {
  /** 本次请求 id，回程帧按它对齐 */
  requestId: string;
  cwd?: string;
  /** 选中的模型 id（对 dsh 是 `provider/model` 形式） */
  model?: string;
  /** 推理档位（该模型的 reasoningOptions 之一） */
  reasoningEffort?: string;
  resumeSessionId?: string;
}

/**
 * 「不指定，用 CLI 自己的配置」。永远排在模型清单最前。
 * 放在契约文件里，免得 defs.ts 为拿它去 import models.ts 造成循环依赖。
 */
export const DEFAULT_MODEL_OPTION: RuntimeModelOption = {
  id: 'default',
  label: '默认（用 CLI 自己的配置）',
};

/**
 * 版本策略（对齐 OpenDesign 的 RuntimeVersionPolicy）。
 *
 * 外部 CLI 会升级、会分叉、旗标会漂移。本构建只对**实测过的版本**负责：
 * - 探不到可用版本 → fail-closed（requireVersion），拒启好过带着错旗标跑出神秘错误
 *   （dsh rc 流改协议参数是血泪史）。
 * - 版本在支持线外 → 仍可用，但给警告——rc 流比我们的发布节奏快，逐个点名会让
 *   按我们安装说明装的用户周周见警告；用发布线正则把「同一线上」的警告消掉，
 *   线外的照样提（匹配线 ≠ 删除检查）。
 */
export interface RuntimeVersionPolicy {
  /** 本构建实测过的精确版本串 */
  supportedVersions: string[];
  /**
   * 发布线匹配（如 rc 流）。**不许带 g 旗标**——RegExp.test 有状态，
   * 同一版本会在支持/未验证之间来回跳。
   */
  supportedVersionPattern?: RegExp;
  /** 版本探不出来或解析失败时拒启。 */
  requireVersion: true;
  /** 归一化版本串（取 "2.1.296 (Claude Code)" 里的 "2.1.296"）；null = 不可用。 */
  parse?: (raw: string) => string | null;
}

/**
 * 能力旗标的值拒绝探针声明（对齐 OpenDesign 的 hiddenCapabilityFlags）。
 * 原理、判定规则与布尔旗标禁区见 capabilities.ts。这里只描述「探哪些旗标」。
 *
 * 与 OpenDesign 单一前缀的差异：同一个旗标在不同子命令下支持集可能不同
 * （codex 的 exec resume 比 exec 窄，实测踩过），所以是**一组探针上下文**，
 * 每个上下文按自己的前缀/后缀独立盘问、独立记录能力键。
 */
export interface RuntimeHiddenCapabilityProbe {
  /** 探针调用前置参数，如 `['-p']` / `['exec', 'resume']`——旗标挂在哪个子命令下就填哪个。 */
  probeArgsPrefix: string[];
  /**
   * 探针调用尾置参数（OpenDesign 原版没有的适配）。codex 的 resume 子命令
   * 会把空 stdin 当线程读取而挂死，必须补上假线程 id 与 prompt 位置参数
   * 让校验走完（2026-10-12 实测）。
   */
  probeArgsSuffix?: string[];
  /** 旗标串 → 能力键（同 capabilityFlags 的形状）。 */
  flags: Record<string, string>;
}

export interface RuntimeHiddenCapabilities {
  probes: RuntimeHiddenCapabilityProbe[];
}

/** 假线程 id：UUID 形状合法（能过格式校验），查不到记录（钉在查找阶段报错）。 */
export const PROBE_FAKE_THREAD_ID = '00000000-0000-4000-8000-000000000000';

/** 从 CLI 的版本行里抠出版本串（semver 形态，允许 -rc.x 后缀）。 */
export function extractSemverish(raw: string): string | null {
  const m = raw.trim().match(/\d+\.\d+\.\d+(?:-[\w.]+)?/);
  return m ? m[0] : null;
}

/**
 * 该运行时是否自带原生会话（多轮靠它的会话机制，**绝不**再注入转写——
 * 双重上下文会让模型复读历史，OpenDesign agy -c 教训）。
 *
 * 三种会话语法的分类学（对齐 OpenDesign）：
 * - `resumesSessionViaCli`         CLI 旗标续接。specify-style（默认）：我方铸
 *                                  会话 id 传给 CLI（claude `--session-id`）；
 *   `capturesSessionIdFromStream`  capture-style：CLI 自铸 id、我方从流里捕获
 *                                  （codex `thread.started`）。
 * - `resumesSessionViaProfileStdio` profile-stdio 线协议带会话 id（dsh），
 *                                  无 CLI resume 旗标。
 */
export function resumesSession(def: Pick<RuntimeDefinition, 'resumesSessionViaCli' | 'resumesSessionViaProfileStdio'>): boolean {
  return def.resumesSessionViaCli === true || def.resumesSessionViaProfileStdio === true;
}

export interface RuntimeDefinition {
  /** 稳定 id，用于日志与前端展示 */
  id: 'claude-code' | 'codex' | 'dsh';
  /** 展示名 */
  displayName: string;
  /** PATH 上的可执行名 */
  executable: string;
  /** 探测：除了在 PATH 上，还需要满足什么（如版本可读） */
  probeArgs: string[];
  /**
   * 生成启动参数。
   * @param prompt          本轮用户输入
   * @param mcpConfigPath   MCP 配置文件路径（claude 方言的 JSON；codex/dsh 各自翻译）
   * @param sessionId       新建会话时指定 id（仅 claude 有此语义）
   * @param resumeSessionId 多轮续接的会话 id（各家语法不同，由定义自己翻译）
   */
  buildArgs(opts: {
    prompt: string;
    mcpConfigPath: string;
    sessionId?: string;
    resumeSessionId?: string;
    extraArgs?: string[];
    /** 已落盘的图片文件路径（codex `-i` 用）；claude 的图走 formatStdinInput，忽略此项 */
    imagePaths?: string[];
    /**
     * 本次要用的模型 id（`listModels`/`fetchModels` 给出的那个）。
     * 不设 = 不传 --model，用 CLI 自己的配置。
     * 定义自己决定怎么翻成 argv（dsh 无处可传，忽略）。
     */
    model?: string;
  }): string[];
  /**
   * 把一行 stdout 归一成事件（一行可能含多块 → 数组）；
   * 已知但对上层无意义的进度噪音返回 null（不下发）；
   * 真解析不了的返回 { kind: 'raw' }。
   */
  parseLine(line: string): AgentEvent | AgentEvent[] | null;
  /**
   * 是否需要 --verbose 一类的参数才能拿到流式输出。
   * Claude Code 的 stream-json 要求 --verbose。
   */
  requiresVerbose?: boolean;
  /**
   * 无原生会话记忆：多轮靠 buildTranscript 把历史注入 prompt（dsh headless）。
   * 带原生会话的运行时**不要**设——注入会造成双重上下文（模型会复读历史）。
   */
  recomposesHistory?: boolean;
  /**
   * prompt 经 stdin 传递，绕开 Windows CreateProcess ~32k 命令行上限
   * （Linux 侧是 MAX_ARG_STRLEN ~128KB 单参上限）。不设则走 argv，
   * 受 maxPromptArgBytes 预算约束。
   */
  promptViaStdin?: boolean;
  /** argv 传 prompt 时的字节预算；超出由调用方拒绝而不是让 spawn 崩。 */
  maxPromptArgBytes?: number;
  /** 登录预检：版本探测后跑一次，按输出判 authStatus（选择器提示用）。 */
  authProbe?: { args: string[]; timeoutMs?: number };
  /**
   * 模型发现，按优先级取第一个成功的：
   *  1. `listModels`   —— CLI 自带 `models` 子命令（有的话最准）
   *  2. `fetchModels`  —— 自定义发现（读配置、探代理路由等）
   *  3. `fallbackModels` —— 兜底提示清单（**不是真清单**，见 RuntimeModelSource）
   * 三者都没有 = 该运行时不做模型选择。
   */
  listModels?: RuntimeListModels;
  fetchModels?: (resolvedBin: string, env: NodeJS.ProcessEnv) => Promise<RuntimeModelOption[] | null>;
  /** 兜底提示。UI 显示用，下发前须对 live 清单校验。 */
  fallbackModels?: RuntimeModelOption[];
  /** false = 不给「手填模型名」入口（模型由 profile/配置定，填了也传不进去）。 */
  supportsCustomModel?: boolean;
  /**
   * 图片递送通道——**只描述「CLI 怎么收图」，不描述「模型能不能看懂」**。
   *
   * 模型能力刻意不建模（对齐 OpenDesign：其 RuntimeModelOption 连 vision 标志都没有，
   * 换多模态模型即可）。代码不该替用户判死模型，那是用户选型的事。
   *
   * - `'stdin-json'`   图片进 stdin 的 JSONL（Anthropic image 块），需配 formatStdinInput
   * - `'argv-paths'`   落盘后以文件路径入参（OpenDesign 的 `supportsImagePaths`），
   *                    需 buildArgs 消费 imagePaths
   * - `'prompt-path'`  落盘后把路径写进 prompt，让 agent 自己用读文件工具看
   *                    （OpenDesign `brands/prefetch.ts` 的做法，与 CLI 图片通道无关）
   * - 不设 = 该 CLI 完全没有图片入口，UI 才禁用贴图
   */
  imageDelivery?: 'stdin-json' | 'argv-paths' | 'prompt-path';
  /**
   * 自定义 stdin 载荷格式。缺省 = prompt 原文（codex/dsh）。
   * claude 在有图时必须走 stream-json JSONL（Anthropic image 块）。
   * 设置了它且有图时，图片不再落临时文件。
   */
  formatStdinInput?: (prompt: string, images?: ImageInput[], ctx?: StdinContext) => string;
  /**
   * 协议级取消：生成「取消这一次请求」的 stdin 载荷。
   *
   * 设了它就说明该运行时**支持优雅取消**——runAgent 的 cancel() 会先发这帧、
   * 等运行时回一帧 `result: cancelled`（保住会话），超时才杀进程。
   * 不设则退回直接杀进程：能停，但没有取消语义、会话也不干净。
   */
  formatCancelInput?: (requestId: string) => string;
  /**
   * 版本策略：实测版本 + 发布线 + 探不出版本时拒启。不设 = 不做版本门。
   * 详见 RuntimeVersionPolicy。
   */
  versionPolicy?: RuntimeVersionPolicy;
  /**
   * PATH 解析失败时的兜底可执行名（按序试）——CLI 的兼容分叉（如 openclaude，
   * 对齐 OpenDesign 的 claude 定义）不用写包装脚本就能被发现。
   */
  fallbackBins?: string[];
  /**
   * 值拒绝探针：探 `--help` 里看不到、或想按子命令分别确认的**带值**旗标。
   * 探测结果缓存在 capabilities.ts，buildArgs 据它决定传不传旗标。
   */
  hiddenCapabilityFlags?: RuntimeHiddenCapabilities;
  /** 原生会话续接（CLI 旗标式）；分类学见 resumesSession()。 */
  resumesSessionViaCli?: boolean;
  /** capture-style：会话 id 由 CLI 自铸、从输出流捕获（codex thread.started）。 */
  capturesSessionIdFromStream?: boolean;
  /** profile-stdio 线协议带会话 id（dsh），无 CLI resume 旗标。 */
  resumesSessionViaProfileStdio?: boolean;
  /**
   * watchdog 分级（对齐 OpenDesign）：静默超时的 per-agent 推荐值——
   * CLI 合法地长时间不吐字（长思考、慢代理）时可放宽。环境变量
   * MATHMOVER_AGENT_INACTIVITY_TIMEOUT_MS 仍优先于本值。
   */
  inactivityTimeoutMs?: number;
  /**
   * 首输出硬顶：从启动到第一条实质输出（text/thinking/tool）的绝对时限。
   * 传输心跳/状态帧**不**顺延它——只在刷状态不干活的挂死才有意义区分。
   * 不设 = 不启用。环境变量 MATHMOVER_AGENT_FIRST_OUTPUT_TIMEOUT_MS 优先。
   */
  firstOutputTimeoutMs?: number;
}

/** 宽松取值：路径不存在时返回 undefined 而不抛错。 */
function pick(obj: unknown, ...path: string[]): any {
  let cur: any = obj;
  for (const k of path) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const t = line.trim();
  if (!t.startsWith('{')) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/**
 * 工具名归一：MCP 工具在流里叫 `mcp__mathmover__ggb_get_state`，
 * 对上层展示 `ggb_get_state` 即可（与 SYSTEM_BRIEF 里的叫法一致）。
 */
function normalizeToolName(name: string): string {
  return name.replace(/^mcp__\w+__/, '');
}

/**
 * Claude Code 无头模式：
 *   claude -p <prompt> --output-format stream-json --verbose \
 *          --include-partial-messages --mcp-config <file> --restricted
 *
 * `--restricted` 去掉 Bash/PowerShell/REPL —— 本产品只需要 ggb_* 工具，
 * 不该让 agent 在用户机器上跑命令。这是刻意的安全收敛。
 * `--include-partial-messages` 打开 stream_event 增量，对话框靠它流式吐字。
 */
/**
 * claude 的兜底提示清单。`claude --model` 收别名或全名，两者都列上。
 * 只是提示——真清单来自 fetchModels 读到的用户配置。
 */
const CLAUDE_FALLBACK_MODELS: RuntimeModelOption[] = [
  { id: 'sonnet', label: 'Sonnet（别名）' },
  { id: 'opus', label: 'Opus（别名）' },
  { id: 'haiku', label: 'Haiku（别名）' },
  { id: 'fable', label: 'Fable（别名）' },
  { id: 'claude-opus-5', label: 'claude-opus-5' },
  { id: 'claude-sonnet-5', label: 'claude-sonnet-5' },
  { id: 'claude-fable-5', label: 'claude-fable-5' },
  { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5' },
];

export const claudeCode: RuntimeDefinition = {
  id: 'claude-code',
  displayName: 'Claude Code',
  executable: 'claude',
  // CLI 分叉兼容：claude 不在 PATH 时按序试 openclaude（对齐 OpenDesign 的
  // claude 定义；单二进制装法的用户见 Gitlawb/openclaude）。分叉的旗标集可能
  // 不同，靠下面的值拒绝探针兜。
  fallbackBins: ['openclaude'],
  probeArgs: ['--version'],
  // 实测版本 2.1.296；发布线 2.x 内的更新不再逐一警告。
  versionPolicy: {
    supportedVersions: ['2.1.296'],
    supportedVersionPattern: /^2\./,
    requireVersion: true,
    parse: extractSemverish,
  },
  // 会话旗标续接，specify-style（--session-id 我方铸 id；capturesSessionIdFromStream 不设）
  resumesSessionViaCli: true,
  // 值拒绝探针（对齐 OpenDesign 的 hiddenCapabilityFlags；假值与判定规则见
  // capabilities.ts）：会话/模型三个带值旗标在分叉或旧版本上可能不存在，
  // 认不出来就摘掉它们而不是死在未知旗标上（会话旗标摘掉 = 降级单轮，仍可跑）。
  hiddenCapabilityFlags: {
    probes: [{
      probeArgsPrefix: ['-p'],
      flags: {
        '--session-id': 'sessionFlag',
        '--resume': 'resumeFlag',
        '--model': 'modelFlag',
      },
    }],
  },
  // 静默超时推荐值（慢代理下长工具往返的保护）；首输出硬顶防「连着只刷状态不干活」
  inactivityTimeoutMs: 180_000,
  firstOutputTimeoutMs: 300_000,
  requiresVerbose: true,
  promptViaStdin: true,
  // 图片与文本统一走 stream-json JSONL 输入行（Anthropic image 块）
  imageDelivery: 'stdin-json',
  formatStdinInput: (prompt, images) => formatClaudeStreamJsonInput(prompt, images),
  authProbe: { args: ['auth', 'status'], timeoutMs: 5000 },
  // `claude` 没有 list-models 子命令（实测 --help / auth status 都不给模型清单）。
  // 发现走配置：用户自定义通道的 ANTHROPIC_DEFAULT_*_MODEL 映射。
  // 没配就只有兜底别名提示——那是提示，不是真清单（见 RuntimeModelSource）。
  fetchModels: async (_bin, _env) => {
    const found = claudeConfiguredModels();
    return found.length ? found : null;
  },
  fallbackModels: CLAUDE_FALLBACK_MODELS,
  supportsCustomModel: true,
  buildArgs({ prompt, mcpConfigPath, sessionId, resumeSessionId, extraArgs = [], model }) {
    // prompt 不进 argv：经 stdin 传 JSONL（input-format 必须与 output-format 配对）。
    // --allowedTools=mcp__mathmover__* 让自家 MCP 工具免权限分类直通：
    // auto 模式下每次工具调用要过 LLM 安全分类器，分类器抖动会拒工具（实测踩过），
    // 白名单既稳又快。= 形式避免变长旗标吞后续参数。
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--mcp-config', mcpConfigPath,
      '--restricted',
      '--allowedTools=mcp__mathmover__*',
    ];
    // 会话/模型旗标按探针结果取舍：探针证实「不认识」才摘（摘了降级单轮/默认模型，
    // 仍可跑）；没探过（如绕过 detect 直调）维持现状照传——误传顶多死在
    // 未知旗标上，那是今天的行为；误摘才是新问题（静默丢会话）。
    const caps = getCapabilities('claude-code');
    const pass = (key: string) => caps?.[key] !== false;
    if (sessionId && pass('sessionFlag')) args.push('--session-id', sessionId);
    if (resumeSessionId && pass('resumeFlag')) args.push('--resume', resumeSessionId);
    // --model 收别名（opus/fable/…）或全名；不设 = 用 CLI 自己的配置
    if (model && pass('modelFlag')) args.push('--model', model);
    return [...args, ...extraArgs];
  },
  parseLine(line) {
    const e = parseJsonLine(line);
    if (!e) return { kind: 'raw', line };

    const type = String(e.type ?? '');

    // 初始化：带出 session id（后续 --resume 用它做多轮）
    // 其余 system 子类型（status / thinking_tokens）是进度噪音，不下发
    if (type === 'system') {
      const sub = String(e.subtype ?? '');
      if (sub === 'init' || !e.subtype) {
        const sid = pick(e, 'session_id') ?? pick(e, 'sessionId');
        return sid ? { kind: 'session', sessionId: String(sid) } : null;
      }
      return null;
    }

    // 助手消息：真实流按块单发（thinking / tool_use / text 各一条），
    // 但一行多块时全部转出，不能只取第一个——否则 text+tool_use 同条会丢工具调用。
    if (type === 'assistant') {
      const content = pick(e, 'message', 'content');
      if (!Array.isArray(content)) return null;
      const events: AgentEvent[] = [];
      for (const part of content) {
        const pt = pick(part, 'type');
        if (pt === 'text') {
          const t = String(pick(part, 'text') ?? '');
          if (t) events.push({ kind: 'text', text: t });
        } else if (pt === 'tool_use') {
          events.push({
            kind: 'tool-call',
            name: normalizeToolName(String(pick(part, 'name') ?? 'tool')),
            toolCallId: String(pick(part, 'id') ?? ''),
            input: pick(part, 'input'),
          });
        } else if (pt === 'thinking') {
          const t = String(pick(part, 'thinking') ?? '');
          if (t) events.push({ kind: 'thinking', text: t });
        }
      }
      if (events.length === 0) return null;
      return events.length === 1 ? events[0] : events;
    }

    // 工具结果回传
    if (type === 'user') {
      const content = pick(e, 'message', 'content');
      if (!Array.isArray(content)) return null;
      const events: AgentEvent[] = [];
      for (const part of content) {
        if (pick(part, 'type') === 'tool_result') {
          events.push({
            kind: 'tool-result',
            toolCallId: String(pick(part, 'tool_use_id') ?? ''),
            output: pick(part, 'content'),
            isError: pick(part, 'is_error') === true,
          });
        }
      }
      if (events.length === 0) return null;
      return events.length === 1 ? events[0] : events;
    }

    // 流式增量（--include-partial-messages）
    if (type === 'stream_event') {
      const ev = pick(e, 'event');
      const et = String(pick(ev, 'type') ?? '');
      const delta = pick(ev, 'delta');
      if (et === 'content_block_delta') {
        const dt = String(pick(delta, 'type') ?? '');
        if (dt === 'text_delta') {
          const t = String(pick(delta, 'text') ?? '');
          return t ? { kind: 'text-delta', text: t } : null;
        }
        if (dt === 'thinking_delta') {
          const t = String(pick(delta, 'thinking') ?? '');
          return t ? { kind: 'thinking', text: t } : null;
        }
        // signature_delta / input_json_delta：完整块稍后随 assistant 事件到达
        return null;
      }
      if (et === 'message_delta') {
        const u = pick(e, 'usage') ?? pick(ev, 'usage');
        if (u) {
          return {
            kind: 'usage',
            inputTokens: pick(u, 'input_tokens') ? Number(pick(u, 'input_tokens')) : undefined,
            outputTokens: pick(u, 'output_tokens') ? Number(pick(u, 'output_tokens')) : undefined,
          };
        }
        return null;
      }
      // message_start/stop、content_block_start/stop：结构性标记，无上层价值
      return null;
    }

    // 收尾
    if (type === 'result') {
      return {
        kind: 'done',
        resultText: pick(e, 'result') ? String(pick(e, 'result')) : undefined,
        sessionId: pick(e, 'session_id') ? String(pick(e, 'session_id')) : undefined,
      };
    }

    return { kind: 'raw', line };
  },
};

/**
 * 把 claude 方言的 MCP 配置（mcpServers JSON）翻译成 codex 的 `-c mcp_servers.*` 键值。
 * 每个 server 附 `default_tools_approval_mode="approve"`（AppToolApproval 枚举：
 * auto|prompt|writes|approve）——自家工具免审批，exec/resume 通用。
 */
function codexMcpArgs(mcpConfigPath: string): string[] {
  try {
    const cfg = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
    const servers = (cfg?.mcpServers ?? {}) as Record<string, { command?: string; args?: string[]; env?: Record<string, string> }>;
    const out: string[] = [];
    for (const [name, s] of Object.entries(servers)) {
      if (!s?.command) continue;
      out.push('-c', `mcp_servers.${name}.command=${JSON.stringify(s.command)}`);
      if (Array.isArray(s.args) && s.args.length) {
        out.push('-c', `mcp_servers.${name}.args=${JSON.stringify(s.args)}`);
      }
      for (const [k, v] of Object.entries(s.env ?? {})) {
        out.push('-c', `mcp_servers.${name}.env.${k}=${JSON.stringify(String(v))}`);
      }
      out.push('-c', `mcp_servers.${name}.default_tools_approval_mode="approve"`);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Codex 无头模式（2026-10-09 真实输出校准）：
 *   codex exec --json --skip-git-repo-check \
 *     -c sandbox_mode="read-only" -c mcp_servers.* ... <prompt>
 *   多轮：codex exec resume <thread_id> <prompt>（thread_id 来自 thread.started 事件）
 *
 * 权限收敛的实测结论（矩阵见 scripts/diag-codex-approval.mjs）：
 * - MCP 工具默认要审批；approval_policy="never"（exec 默认）直接拒
 * - 唯一正解：per-server 的 `default_tools_approval_mode="approve"`（配置键，
 *   exec/resume 通用）。`mcp_tool_approval` / `trusted` / `tool_approval` 都不是真键；
 *   `--approve-for-me` 旗标只有 exec 有且 resume 用不了，别走那条路
 * - `--sandbox` 旗标与 --approve-for-me 互斥无关了；沙箱用 `-c sandbox_mode="read-only"`
 *   （对应 claude 侧 --restricted 的安全收敛：shell 只读 + 自家 MCP 放行）
 *
 * 事件形状（JSONL）：thread.started / turn.started /
 *   item.started|item.completed（item.type=agent_message|mcp_tool_call|reasoning|error）/
 *   turn.completed（usage）。
 */
/**
 * 读 ~/.codex/config.toml 里的 `model = "..."`。
 *
 * 只抠这一行，不引 TOML 依赖（配置格式稳定，正则够用）。
 * 自定义 provider 时实际可用模型集由端点决定，这里只知道「配好的那个」。
 */
function readCodexConfiguredModel(): RuntimeModelOption | null {
  try {
    const file = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.codex', 'config.toml');
    const text = fs.readFileSync(file, 'utf-8');
    const m = /^\s*model\s*=\s*["']([^"']+)["']/m.exec(text);
    if (!m) return null;
    return { id: m[1], label: `${m[1]}（config.toml）` };
  } catch {
    return null;
  }
}

export const codex: RuntimeDefinition = {
  id: 'codex',
  displayName: 'Codex',
  executable: 'codex',
  probeArgs: ['--version'],
  // 实测版本 0.162.1；0.x 发布线内不逐一警告（pre-1.0 次版本仍可能变旗标，
  // 由下面的值拒绝探针与 fail-closed 兜底）。
  versionPolicy: {
    supportedVersions: ['0.162.1'],
    supportedVersionPattern: /^0\./,
    requireVersion: true,
    parse: extractSemverish,
  },
  // 会话旗标续接 + capture-style：thread_id 由 CLI 自铸、我方从 thread.started 捕获
  resumesSessionViaCli: true,
  capturesSessionIdFromStream: true,
  // `--model` 是带值旗标，exec 与 exec resume 的旗标集不同（resume 更窄，
  // 实测没有 --sandbox/--approve-for-me 等）——两个前缀分别探、分别确认。
  // resume 探针必须带假线程 id 与 prompt 位置参数：不带位置参数时它把空 stdin
  // 当线程读取而挂死（2026-10-12 实测）。
  hiddenCapabilityFlags: {
    probes: [
      // exec：`-` 是 prompt 读 stdin 的哨兵，配空 stdin 快速走完解析
      { probeArgsPrefix: ['exec'], probeArgsSuffix: ['-'], flags: { '--model': 'modelFlag' } },
      // exec resume：必须带假线程 id 与 prompt 位置参数，否则把空 stdin 当线程读取而挂死
      {
        probeArgsPrefix: ['exec', 'resume'],
        probeArgsSuffix: [PROBE_FAKE_THREAD_ID, 'p'],
        flags: { '--model': 'resumeModelFlag' },
      },
    ],
  },
  inactivityTimeoutMs: 180_000,
  firstOutputTimeoutMs: 300_000,
  promptViaStdin: true,
  // 落盘后走 `-i <file>...`（buildArgs 消费 imagePaths）
  imageDelivery: 'argv-paths',
  authProbe: { args: ['login', 'status'], timeoutMs: 5000 },
  // codex 的模型在 ~/.codex/config.toml（model = "..."）。自定义 provider 时实际
  // 可用集由那个端点决定，我们无从枚举——所以发现只取「已配好的那个」，
  // 其余交给 supportsCustomModel 手填。
  fetchModels: async (_bin, _env) => {
    const m = readCodexConfiguredModel();
    return m ? [m] : null;
  },
  fallbackModels: [
    { id: 'gpt-5.6-luna', label: 'gpt-5.6-luna' },
    { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
  ],
  supportsCustomModel: true,
  buildArgs({ prompt, mcpConfigPath, resumeSessionId, imagePaths = [], extraArgs = [], model }) {
    // prompt 不进 argv：`-` 位置参数表示读 stdin（exec 与 exec resume 同语义）。
    // 布局要点（实测踩坑）：`-i` 是变长旗标，图片后必须 `--` 终结否则吞 prompt；
    // 而 `--` 之后全是位置参数——所以旗标必须排在 `--` 前面，prompt 哨兵放最末。
    const head = resumeSessionId ? ['exec', 'resume', resumeSessionId] : ['exec'];
    // --model 必须在 `--` 之前（它是旗标，不是位置参数）。
    // exec 与 exec resume 的旗标集不同，按各自探针结果取舍（规则同 claude：
    // 证实不认识才摘，没探过照传）。
    const caps = getCapabilities('codex');
    const modelCap = resumeSessionId ? 'resumeModelFlag' : 'modelFlag';
    return [
      ...head,
      '--json',
      '--skip-git-repo-check',
      '-c', 'sandbox_mode="read-only"',
      ...(model && caps?.[modelCap] !== false ? ['--model', model] : []),
      ...codexMcpArgs(mcpConfigPath),
      ...extraArgs,
      ...(imagePaths.length ? ['-i', ...imagePaths, '--'] : []),
      '-',
    ];
  },
  parseLine(line) {
    const e = parseJsonLine(line);
    if (!e) return { kind: 'raw', line };
    const type = String(e.type ?? '');

    if (type === 'thread.started') {
      const sid = pick(e, 'thread_id');
      return sid ? { kind: 'session', sessionId: String(sid) } : null;
    }
    if (type === 'turn.started') return null;

    if (type === 'turn.completed') {
      const u = pick(e, 'usage');
      if (!u) return null;
      return {
        kind: 'usage',
        inputTokens: pick(u, 'input_tokens') ? Number(pick(u, 'input_tokens')) : undefined,
        outputTokens: pick(u, 'output_tokens') ? Number(pick(u, 'output_tokens')) : undefined,
      };
    }

    if (type === 'turn.failed') {
      return { kind: 'error', message: String(pick(e, 'error', 'message') ?? pick(e, 'message') ?? 'codex 运行失败') };
    }

    if (type === 'item.started' || type === 'item.completed') {
      const item = pick(e, 'item');
      const it = String(pick(item, 'type') ?? '');
      const id = String(pick(item, 'id') ?? '');

      if (it === 'agent_message') {
        if (type !== 'item.completed') return null; // started 时 text 未定稿
        const t = String(pick(item, 'text') ?? '');
        return t ? { kind: 'text', text: t } : null;
      }

      if (it === 'mcp_tool_call') {
        const name = normalizeToolName(String(pick(item, 'tool') ?? 'tool'));
        if (type === 'item.started') {
          return { kind: 'tool-call', name, toolCallId: id, input: pick(item, 'arguments') };
        }
        const err = pick(item, 'error');
        const failed = err != null || String(pick(item, 'status') ?? '') === 'failed';
        return {
          kind: 'tool-result',
          toolCallId: id,
          output: pick(item, 'result') ?? err,
          isError: failed,
        };
      }

      if (it === 'error' && type === 'item.completed') {
        return { kind: 'error', message: String(pick(item, 'message') ?? 'codex 出错') };
      }

      // reasoning / command_execution / 其他内部项不下发
      return null;
    }

    return { kind: 'raw', line };
  },
};

/**
 * DeepSeek Harness：`dsh --patch <补丁> --profile headless "<task>"`。
 *
 * 2026-10-09 真实校准。headless 是 one-shot（其 README 明示"one submitted task only"、
 * 无后续对话面、每次新建会话）——**无多轮续接**，微调靠画布状态（ggb_get_state）兜底。
 * MCP 挂载走 `--patch` 叠 dsh-mcp-client 插件补丁（与 claude-mcp.json 同目录的
 * dsh-mathmover.patch.yml，不动用户 profile）。输出是纯文本：stdout 只有最终
 * assistant 消息（失败细节在 stderr、退出码非 0）。
 */
/**
 * 我们自带的 dsh profile（装了 JSONL 协议 bundle）。
 *
 * 2026-10-12 从「headless + prompt 走 argv 一次性」切到 stdio 协议：
 * headless 的 app 不收模型参数、没有模型目录，选中的模型传不过去；而 stdio 的
 * `execute` 帧带 `model: {provider, id}`，且有原生会话（session_id / resume）。
 *
 * 协议形状对齐 OpenDesign 的 `packages/dsh-runtime`（Apache-2.0）：
 *   上行 execute/cancel，下行 ready/session/thinking/text/tool_call/
 *   tool_result/usage/result/protocol_error。
 */
const DSH_PROFILE = 'mathmover';

/**
 * dsh 的模型 id 形如 `provider/model`（下行目录里也是这两段分开的）。
 * 格式不对就返回 undefined——宁可不传模型让 profile 用自己的默认，也不瞎猜。
 */
function dshModelSelection(id: string | undefined): { provider: string; id: string } | undefined {
  const s = (id ?? '').trim();
  if (!s || s === 'default') return undefined;
  const i = s.indexOf('/');
  if (i <= 0 || i === s.length - 1) return undefined;
  return { provider: s.slice(0, i), id: s.slice(i + 1) };
}

/** 解析 `--models` 吐的 JSONL（单帧 `{type:'models', models:[…]}`）。 */
function parseDshModels(stdout: string): RuntimeModelOption[] | null {
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let frame: unknown;
    try { frame = JSON.parse(line); } catch { continue; }
    const rec = pick(frame, 'type') === 'models' ? frame as { models?: unknown } : null;
    if (!rec || !Array.isArray(rec.models)) continue;
    const out: RuntimeModelOption[] = [];
    for (const item of rec.models) {
      const provider = pick(item, 'provider');
      const id = pick(item, 'id');
      if (typeof provider !== 'string' || typeof id !== 'string') continue;
      const name = typeof pick(item, 'name') === 'string' && pick(item, 'name') ? pick(item, 'name') : id;
      const providerName = typeof pick(item, 'provider_name') === 'string' && pick(item, 'provider_name')
        ? pick(item, 'provider_name') : provider;
      // id 保持 provider/model 形式——下发时由 dshModelSelection 拆回两段
      const entry: RuntimeModelOption = { id: `${provider}/${id}`, label: `${name} · ${providerName}` };
      const efforts = pick(item, 'reasoning_options');
      if (Array.isArray(efforts)) {
        const opts = efforts.flatMap((rawEffort) => {
          const eid = pick(rawEffort, 'id');
          const ename = pick(rawEffort, 'name');
          if (typeof eid !== 'string') return [];
          const def = pick(rawEffort, 'default') === true;
          return [{ id: eid, label: typeof ename === 'string' && ename ? ename : eid, ...(def ? { default: true } : {}) }];
        });
        if (opts.length) entry.reasoningOptions = opts;
      }
      out.push(entry);
    }
    return out.length ? out : null;
  }
  return null;
}

export const dsh: RuntimeDefinition = {
  id: 'dsh',
  displayName: 'DeepSeek Harness',
  executable: 'dsh',
  probeArgs: ['--version'],
  // rc 流版本比发布节奏快（0.1.1-rc.x），点名单个 rc 会让用户周周见警告——
  // 发布线正则钉在 0.1.x-rc 流（跨小版本可能换协议，该警告），线外照样提。
  versionPolicy: {
    supportedVersions: ['0.1.1-rc.1'],
    supportedVersionPattern: /^0\.1\.\d+-rc\.\d+$/,
    requireVersion: true,
    parse: extractSemverish,
  },
  // 会话走 profile-stdio 线协议（session_id / resume_session_id 帧），无 CLI 旗标
  resumesSessionViaProfileStdio: true,
  // 慢代理下长思考可静默数分钟（曾撞 3 分钟路由超时），静默阈值比 claude/codex 宽
  inactivityTimeoutMs: 300_000,
  firstOutputTimeoutMs: 300_000,
  // 协议有原生会话（session_id / resume_session_id），不再需要转写注入。
  // 早先 headless 是一次性无会话，才靠 buildTranscript 补语境；现在重复注入会双份上下文。
  recomposesHistory: false,
  // 图片走「prompt 里给路径」，不用 execute 帧的 inline images —— 2026-10-12
  // 实测对照过两条路，prompt-path **严格更优**：
  //   prompt-path：大小图都行，模型读出了完整题干与坐标（连 3066px 的图也正常）
  //   inline：被附件服务的 maxImageDimension=2000 挡住，大图直接失败
  // 而且题目截图经常超 2000px。inline 通路已实现并验过（小图模型能看懂），
  // 留在 protocol.ts 的 images 字段作退路，别当闲置代码删。
  // 模型能不能看懂是模型的事——换多模态模型即可，这里不替用户判死。
  imageDelivery: 'prompt-path',
  // prompt 走 stdin 的 execute 帧（不再是 argv 位置参数），故无 argv 预算限制
  promptViaStdin: true,
  listModels: {
    args: ['--profile', DSH_PROFILE, '--models'],
    timeoutMs: 10_000,
    parse: parseDshModels,
  },
  fallbackModels: [DEFAULT_MODEL_OPTION],
  supportsCustomModel: true,
  buildArgs({ mcpConfigPath, extraArgs = [] }) {
    // MCP 仍走 patch 叠插件（execute 帧的 mcp_servers 恒空数组，那是另一条通道）
    const patchPath = path.join(path.dirname(mcpConfigPath), 'dsh-mathmover.patch.yml');
    return ['--patch', patchPath, '--profile', DSH_PROFILE, '--stdio', ...extraArgs];
  },
  formatStdinInput(prompt, _images, ctx) {
    const model = dshModelSelection(ctx?.model);
    return JSON.stringify({
      v: 1,
      type: 'execute',
      request_id: ctx?.requestId ?? 'request',
      cwd: ctx?.cwd ?? process.cwd(),
      prompt,
      mcp_servers: [],
      ...(ctx?.resumeSessionId ? { resume_session_id: ctx.resumeSessionId } : {}),
      ...(model ? { model } : {}),
      ...(ctx?.reasoningEffort ? { reasoning_effort: ctx.reasoningEffort } : {}),
    }) + '\n';
  },
  // 协议级取消：bundle 收到后 abort 本次请求并回 `result: cancelled`，会话可续
  formatCancelInput: (requestId) => JSON.stringify({ v: 1, type: 'cancel', request_id: requestId }) + '\n',
  parseLine(line) {
    const e = parseJsonLine(line);
    if (!e) return { kind: 'raw', line };
    const type = String(e.type ?? '');
    switch (type) {
      case 'session': {
        const sid = pick(e, 'session_id');
        return sid ? { kind: 'session', sessionId: String(sid) } : null;
      }
      case 'text': {
        const t = String(pick(e, 'content') ?? '');
        return t ? { kind: 'text', text: t } : null;
      }
      case 'thinking': {
        const t = String(pick(e, 'content') ?? '');
        return t ? { kind: 'thinking', text: t } : null;
      }
      case 'tool_call': {
        let input: unknown = pick(e, 'arguments');
        if (typeof input === 'string') {
          try { input = JSON.parse(input); } catch { input = { raw: input }; }
        }
        return {
          kind: 'tool-call',
          name: normalizeToolName(String(pick(e, 'name') ?? 'tool')),
          toolCallId: String(pick(e, 'call_id') ?? ''),
          input,
        };
      }
      case 'tool_result':
        return {
          kind: 'tool-result',
          toolCallId: String(pick(e, 'call_id') ?? ''),
          output: pick(e, 'output'),
          isError: Boolean(pick(e, 'is_error')),
        };
      case 'usage': {
        const it = pick(e, 'input_tokens');
        const ot = pick(e, 'output_tokens');
        return {
          kind: 'usage',
          inputTokens: typeof it === 'number' ? it : undefined,
          outputTokens: typeof ot === 'number' ? ot : undefined,
        };
      }
      case 'result': {
        const sid = pick(e, 'session_id');
        const sessionId = sid ? String(sid) : undefined;
        const status = String(pick(e, 'status') ?? '');
        if (status === 'failed') {
          const err = pick(e, 'error');
          const msg = String(pick(err, 'message') ?? pick(e, 'output') ?? 'dsh 运行失败');
          return [{ kind: 'error', message: msg }, { kind: 'done', sessionId }];
        }
        // cancelled 与 completed 都是「正常收尾」，但要分得开：
        // 取消不是失败（会话还在），也不该被显示成跑完了。
        return {
          kind: 'done',
          resultText: String(pick(e, 'output') ?? ''),
          sessionId,
          status: status === 'cancelled' ? 'cancelled' : 'completed',
        };
      }
      case 'protocol_error':
        return {
          kind: 'error',
          message: `dsh 协议错误 ${String(pick(e, 'code') ?? '')}: ${String(pick(e, 'message') ?? '')}`,
        };
      // 握手与目录帧不下发
      case 'ready':
      case 'probe':
      case 'models':
        return null;
      default:
        return { kind: 'raw', line };
    }
  },
};

export const RUNTIMES: RuntimeDefinition[] = [claudeCode, codex, dsh];
