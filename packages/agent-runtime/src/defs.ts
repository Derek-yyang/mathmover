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

/** 归一后的事件——前端 useChat 与上层编排都只认这个。 */
export type AgentEvent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'text-delta'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; name: string; toolCallId: string; input?: unknown }
  | { kind: 'tool-result'; toolCallId: string; output?: unknown; isError?: boolean }
  | { kind: 'thinking'; text: string }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number }
  | { kind: 'done'; resultText?: string; sessionId?: string }
  | { kind: 'error'; message: string }
  | { kind: 'raw'; line: string };

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
  /** 能不能看图（dsh 看不了）。UI 据此禁用粘贴图片，路由降级为占位文本。 */
  supportsImages?: boolean;
  /**
   * 自定义 stdin 载荷格式。缺省 = prompt 原文（codex/dsh）。
   * claude 在有图时必须走 stream-json JSONL（Anthropic image 块）。
   * 设置了它且有图时，图片不再落临时文件。
   */
  formatStdinInput?: (prompt: string, images?: ImageInput[]) => string;
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
export const claudeCode: RuntimeDefinition = {
  id: 'claude-code',
  displayName: 'Claude Code',
  executable: 'claude',
  probeArgs: ['--version'],
  requiresVerbose: true,
  promptViaStdin: true,
  supportsImages: true,
  // 图片与文本统一走 stream-json JSONL 输入行（Anthropic image 块）
  formatStdinInput: (prompt, images) => formatClaudeStreamJsonInput(prompt, images),
  authProbe: { args: ['auth', 'status'], timeoutMs: 5000 },
  buildArgs({ prompt, mcpConfigPath, sessionId, resumeSessionId, extraArgs = [] }) {
    // prompt 不进 argv：经 stdin 传 JSONL（input-format 必须与 output-format 配对）
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--mcp-config', mcpConfigPath,
      '--restricted',
    ];
    if (sessionId) args.push('--session-id', sessionId);
    if (resumeSessionId) args.push('--resume', resumeSessionId);
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
export const codex: RuntimeDefinition = {
  id: 'codex',
  displayName: 'Codex',
  executable: 'codex',
  probeArgs: ['--version'],
  promptViaStdin: true,
  supportsImages: true,
  authProbe: { args: ['login', 'status'], timeoutMs: 5000 },
  buildArgs({ prompt, mcpConfigPath, resumeSessionId, imagePaths = [], extraArgs = [] }) {
    // prompt 不进 argv：`-` 位置参数表示读 stdin（exec 与 exec resume 同语义）。
    // 布局要点（实测踩坑）：`-i` 是变长旗标，图片后必须 `--` 终结否则吞 prompt；
    // 而 `--` 之后全是位置参数——所以旗标必须排在 `--` 前面，prompt 哨兵放最末。
    const head = resumeSessionId ? ['exec', 'resume', resumeSessionId] : ['exec'];
    return [
      ...head,
      '--json',
      '--skip-git-repo-check',
      '-c', 'sandbox_mode="read-only"',
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
export const dsh: RuntimeDefinition = {
  id: 'dsh',
  displayName: 'DeepSeek Harness',
  executable: 'dsh',
  probeArgs: ['--version'],
  // headless 无原生会话：多轮靠转写注入（buildTranscript），不再标"单轮"
  recomposesHistory: true,
  // DeepSeek 模型看不了图（实测它自己会说"PNG 我这个模型看不了"）
  supportsImages: false,
  // task 走 argv 位置参数（headless 不读 stdin），超预算直接拒绝
  maxPromptArgBytes: 24_000,
  buildArgs({ prompt, mcpConfigPath, extraArgs = [] }) {
    const patchPath = path.join(path.dirname(mcpConfigPath), 'dsh-mathmover.patch.yml');
    return ['--patch', patchPath, '--profile', 'headless', prompt, ...extraArgs];
  },
  parseLine(line) {
    // headless 正文是纯文本（没有 JSON 事件）；JSON 行反而透传 raw 便于诊断
    if (parseJsonLine(line)) return { kind: 'raw', line };
    return line.trim() ? { kind: 'text', text: line + '\n' } : null;
  },
};

export const RUNTIMES: RuntimeDefinition[] = [claudeCode, codex, dsh];
