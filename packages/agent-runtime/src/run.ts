/**
 * 启动 agent CLI 并把它的输出归一成 AgentEvent 流。
 *
 * 形态（OpenDesign 的 spawn 模式）：子进程 + 受管工作目录 + 按行解析。
 * 不用 PTY：无头模式的输出本来就是结构化的，PTY 反而要处理控制字符。
 *
 * 关键设计：
 *  - **一个 run = 一个子进程**。多轮靠 --session-id / --resume 续，不复用进程。
 *  - 输出按行切分缓冲（子进程会分片写，不能假设一次 read 就是一行）。
 *  - 解析失败不打断——透传 raw 事件，调用方可自行处理或忽略。
 *  - 取消走 SIGTERM/kill；Windows 上 spawn 不认 POSIX 信号，故补 taskkill 由调用方负责。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { AgentEvent, RuntimeDefinition } from './defs.ts';
import { resolveRuntimeTarget } from './resolve.ts';
import { withClaudeSettingsEnv } from './claude-env.ts';
import { materializeImages, toImagePathNote, toImageUndeliveredNote, type ImageInput } from './images.ts';

export interface RunOptions {
  def: RuntimeDefinition;
  prompt: string;
  mcpConfigPath: string;
  cwd?: string;
  sessionId?: string;
  /** 多轮续接的会话 id（各家语法由 RuntimeDefinition 自己翻译） */
  resumeSessionId?: string;
  /** 题目图片（设了 imageDelivery 的运行时才递送，通道见 defs.ts） */
  images?: ImageInput[];
  /**
   * 本次要用的模型 id。不设 = 不传 --model，用 CLI 自己的配置。
   * 调用方应先用 resolveModel() 校验——不要直接透传用户输入。
   */
  model?: string;
  /** 推理档位（该模型 reasoningOptions 之一）。只对支持的运行时生效。 */
  reasoningEffort?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  /** 墙钟硬超时（毫秒）；超时杀进程并发 error 事件 */
  timeoutMs?: number;
  /**
   * **静默**超时（毫秒）——不是墙钟：stdout/stderr 有输出就顺延。
   * 慢代理下 SOP 流程（多轮工具往返）曾被 5 分钟墙钟掐死在半路，只有彻底静默才算死。
   * 不设则不启用。
   */
  inactivityTimeoutMs?: number;
  /**
   * **首输出**硬顶（毫秒）：从启动到第一条实质输出（正文/思考/工具）的绝对时限。
   * 与 inactivityTimeoutMs 的区别：传输心跳/状态帧（session、raw、usage）**不**顺延
   * 本项——只刷状态不干活的挂死才兜得住（对齐 OpenDesign 的 firstOutputTimeoutMs）。
   * 不设则不启用。
   */
  firstOutputTimeoutMs?: number;
  onEvent: (e: AgentEvent) => void;
}

export interface RunHandle {
  /** 结束时 resolve；异常结束会带上最后一条 error 事件 */
  done: Promise<{ exitCode: number | null; sessionId?: string }>;
  /** 主动取消 */
  cancel: () => void;
  /** 被 spawn 的进程（只读，勿直接操作）；预算拒绝等未启动场景为 null */
  readonly proc: ChildProcessWithoutNullStreams | null;
}

export function runAgent(opts: RunOptions): RunHandle {
  // 图片递送按通道分流（见 defs.ts 的 imageDelivery）：只描述「CLI 怎么收图」，
  // 模型能不能看懂不建模。四种情况：
  //   stdin-json   图块进 stdin，不落盘、不加说明
  //   argv-paths   落盘，路径由 buildArgs 带进 argv，不加说明
  //   prompt-path  落盘，路径写进 prompt 让 agent 自己看
  //   无通道       不递送也不落盘，prompt 如实说「图片未送达」
  //
  // 注意 images **不要**按通道清空——无通道时还要数出张数才知道该说明几张没送到
  //（清空会让下面的 imageNote 短路成 ''，说明就丢了）。
  const delivery = opts.def.imageDelivery;
  const images = opts.images ?? [];
  const needsFiles = images.length > 0 && (delivery === 'argv-paths' || delivery === 'prompt-path');
  const materialized = needsFiles
    ? materializeImages(images, opts.def.imageMaterializeInCwd ? opts.cwd : undefined)
    : { paths: [] as string[], cleanup: () => {} };
  const imageNote = images.length === 0 ? ''
    : delivery === 'prompt-path' ? toImagePathNote(materialized.paths)
    : delivery ? ''
    : toImageUndeliveredNote(images.length);
  const prompt = imageNote ? `${opts.prompt}\n\n${imageNote}` : opts.prompt;
  const inlineImages = delivery === 'stdin-json' ? images : [];

  // argv 传 prompt 的预算守卫：宁可明着拒绝，不要 ENAMETOOLONG 崩 spawn
  const budget = opts.def.maxPromptArgBytes ?? 24_000;
  if (!opts.def.promptViaStdin && Buffer.byteLength(prompt, 'utf-8') > budget) {
    materialized.cleanup();
    opts.onEvent({
      kind: 'error',
      message: `prompt 超过命令行预算 ${budget} 字节（${opts.def.displayName} 不支持 stdin 传入），请缩短输入`,
    });
    return {
      done: Promise.resolve({ exitCode: null, sessionId: opts.sessionId }),
      cancel: () => {},
      proc: null,
    };
  }

  const args = opts.def.buildArgs({
    prompt,
    mcpConfigPath: opts.mcpConfigPath,
    sessionId: opts.sessionId,
    resumeSessionId: opts.resumeSessionId,
    extraArgs: opts.extraArgs,
    imagePaths: materialized.paths,
    model: opts.model,
    reasoningEffort: opts.reasoningEffort,
    // 与下面 spawn 的 cwd 取同一个值——需要把工作目录写进 argv 的定义（opencode
    // 的 --dir）才不会和真实 cwd 说的不是一回事。
    cwd: opts.cwd,
  });

  // 不经 shell：参数走 argv 数组，避免命令注入（见 resolve.ts）。
  // resolveRuntimeTarget 按 executable + fallbackBins 逐名解析（分叉兼容），
  // .cmd shim 解析成真实入口，**prefixArgs 必须一起带**——
  // .js 入口的场景 command 是 node、脚本路径在 prefixArgs 里，丢了它等于 spawn 空 node。
  const target = resolveRuntimeTarget(opts.def)
    ?? { command: opts.def.executable, prefixArgs: [] as string[], label: opts.def.executable };

  // claude --restricted 会忽略 settings.json 的 env 块（自定义通道的认证在那），
  // spawn 时补回去；显式进程环境优先。见 claude-env.ts。
  const spawnEnv = opts.def.id === 'claude-code'
    ? withClaudeSettingsEnv({ ...process.env, ...opts.env })
    : { ...process.env, ...opts.env };
  const proc = spawn(target.command, [...target.prefixArgs, ...args], {
    cwd: opts.cwd ?? process.cwd(),
    env: spawnEnv,
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;

  opts.onEvent({ kind: 'raw', line: `# 启动 ${opts.def.displayName}（${target.command.split(/[\\/]/).pop()}）` });

  // prompt 通道：stdin 优先（绕 argv 长度上限），argv 模式直接关 stdin 防空等
  // requestId 提到外面：协议级取消要拿它对齐回程帧（按 id 命中本次请求）
  const requestId = randomUUID();
  const supportsCancelFrame = typeof opts.def.formatCancelInput === 'function';
  if (opts.def.promptViaStdin) {
    const payload = opts.def.formatStdinInput
      ? opts.def.formatStdinInput(prompt, inlineImages, {
          requestId,
          cwd: opts.cwd,
          model: opts.model,
          reasoningEffort: opts.reasoningEffort,
          resumeSessionId: opts.resumeSessionId,
        })
      : prompt;
    proc.stdin.write(payload);
  }
  // 支持协议级取消的运行时**不关 stdin**——关了就没法再发 cancel 帧。
  // 运行时跑完会自己收尾（dsh 侧是 exit(0) + 1 秒 forceExit 兜底）。
  if (!supportsCancelFrame) proc.stdin.end();

  let sessionId: string | undefined = opts.sessionId;
  let buf = '';
  let stderrBuf = '';

  // 首输出硬顶：启动即上膛，第一发实质输出解除；状态帧不顺延（语义见 RunOptions）
  let firstOutputTimer: ReturnType<typeof setTimeout> | undefined;
  const clearFirstOutput = () => {
    if (firstOutputTimer !== undefined) {
      clearTimeout(firstOutputTimer);
      firstOutputTimer = undefined;
    }
  };
  if (opts.firstOutputTimeoutMs && opts.firstOutputTimeoutMs > 0) {
    firstOutputTimer = setTimeout(() => {
      opts.onEvent({ kind: 'error', message: `agent 首输出超时（${opts.firstOutputTimeoutMs}ms 内无实质输出）` });
      try { proc.kill(); } catch { /* 已退出 */ }
    }, opts.firstOutputTimeoutMs);
  }

  // 实质输出才算数：text/thinking/tool 是干活；session/raw/usage 是状态与心跳，
  // 不解除首输出硬顶（见 RunOptions.firstOutputTimeoutMs）
  const SUBSTANTIVE_KINDS = new Set(['text', 'text-delta', 'thinking', 'tool-call', 'tool-result']);

  const emitLine = (line: string) => {
    if (!line.trim()) return;
    const parsed = opts.def.parseLine(line);
    if (!parsed) return;
    for (const ev of Array.isArray(parsed) ? parsed : [parsed]) {
      if (SUBSTANTIVE_KINDS.has(ev.kind)) clearFirstOutput();
      if (ev.kind === 'session') sessionId = ev.sessionId;
      if (ev.kind === 'done') {
        // 兜底：result 帧自带 session id。万一 session 帧丢了/晚到，
        // resolved 的 sessionId 也不该是空——那会让多轮续接断掉。
        if (ev.sessionId) sessionId = ev.sessionId;
        opts.onEvent({ ...ev, sessionId: ev.sessionId ?? sessionId });
      } else {
        opts.onEvent(ev);
      }
    }
  };

  // stdout 按行切（子进程分片写，不能假设一次 read 就是一行）；
  // stderr 只累积——退出码非 0 时把尾巴报出去，平时不打扰事件流。
  const drainOut = (chunk: string) => {
    buf += chunk;
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const l of parts) emitLine(l);
  };
  proc.stdout.on('data', (d) => drainOut(d.toString()));
  proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });

  // 静默超时：不是墙钟，有输出就顺延（慢代理下多轮工具往返曾被墙钟掐死在半路）
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const armKill = () => {
    if (!opts.inactivityTimeoutMs) return;
    clearTimeout(killTimer);
    killTimer = setTimeout(() => {
      opts.onEvent({ kind: 'error', message: `agent 静默超时（${opts.inactivityTimeoutMs}ms 无输出）` });
      try { proc.kill(); } catch { /* 已退出 */ }
    }, opts.inactivityTimeoutMs);
  };
  armKill();
  proc.stdout.on('data', armKill);
  proc.stderr.on('data', armKill);

  // 墙钟硬超时（可选）
  let wallTimer: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    wallTimer = setTimeout(() => {
      opts.onEvent({ kind: 'error', message: `agent 运行超时（${opts.timeoutMs}ms）` });
      try { proc.kill(); } catch { /* 已退出 */ }
    }, opts.timeoutMs);
  }

  const done = new Promise<{ exitCode: number | null; sessionId?: string }>((resolve) => {
    proc.on('error', (e) => {
      clearTimeout(killTimer);
      clearTimeout(wallTimer);
      clearFirstOutput();
      opts.onEvent({ kind: 'error', message: `启动 ${opts.def.displayName} 失败: ${e.message}` });
      materialized.cleanup();
      resolve({ exitCode: null, sessionId });
    });
    proc.on('close', (code) => {
      clearTimeout(killTimer);
      clearTimeout(wallTimer);
      clearFirstOutput();
      if (buf.trim()) drainOut('\n');   // stdout 残留的最后一行（没换行结尾的）
      const tail = stderrBuf.trim();
      if (tail && code !== 0) {
        opts.onEvent({ kind: 'error', message: `${opts.def.displayName} 退出码 ${code}：${tail.slice(-500)}` });
      }
      // 注意：parseLine 可能已经发过一次带 resultText 的 done（claude 的 result 事件），
      // 这里再补一次是「流结束」信号——与 route 层历史行为一致，勿单方面去掉。
      opts.onEvent({ kind: 'done', sessionId, resultText: undefined });
      materialized.cleanup();
      resolve({ exitCode: code, sessionId });
    });
  });

  return {
    done,
    cancel: () => {
      // 协议级取消优先：发 cancel 帧让运行时自己收尾（回 result: cancelled、
      // 保住会话可续）。只在它迟迟不退时才杀进程——杀早了就丢掉那帧，
      // 会话也不干净。宽限取 3.5s，比 dsh 侧的 3s 取消宽限略长。
      if (supportsCancelFrame && proc.stdin.writable) {
        try {
          proc.stdin.write(opts.def.formatCancelInput!(requestId));
          const killTimer = setTimeout(() => { try { proc.kill(); } catch { /* 已退出 */ } }, 3_500);
          killTimer.unref?.();
          return;
        } catch { /* stdin 已关等：落到下面直接杀 */ }
      }
      try { proc.kill(); } catch { /* 已退出 */ }
    },
    proc,
  };
}
