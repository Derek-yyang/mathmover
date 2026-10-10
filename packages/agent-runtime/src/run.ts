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
import type { AgentEvent, RuntimeDefinition } from './defs.ts';
import { resolveSpawnTarget } from './resolve.ts';
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
    ? materializeImages(images)
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
  });

  // 不经 shell：参数走 argv 数组，避免命令注入（见 resolve.ts）。
  // resolveSpawnTarget 把 npm 的 .cmd shim 解析成真实入口，**prefixArgs 必须一起带**——
  // .js 入口的场景 command 是 node、脚本路径在 prefixArgs 里，丢了它等于 spawn 空 node。
  const target = resolveSpawnTarget(opts.def.executable)
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
  if (opts.def.promptViaStdin) {
    const payload = opts.def.formatStdinInput
      ? opts.def.formatStdinInput(prompt, inlineImages)
      : prompt;
    proc.stdin.write(payload);
  }
  proc.stdin.end();

  let sessionId: string | undefined = opts.sessionId;
  let buf = '';
  let stderrBuf = '';

  const emitLine = (line: string) => {
    if (!line.trim()) return;
    const parsed = opts.def.parseLine(line);
    if (!parsed) return;
    for (const ev of Array.isArray(parsed) ? parsed : [parsed]) {
      if (ev.kind === 'session') sessionId = ev.sessionId;
      if (ev.kind === 'done') {
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
      opts.onEvent({ kind: 'error', message: `启动 ${opts.def.displayName} 失败: ${e.message}` });
      materialized.cleanup();
      resolve({ exitCode: null, sessionId });
    });
    proc.on('close', (code) => {
      clearTimeout(killTimer);
      clearTimeout(wallTimer);
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
      try { proc.kill(); } catch { /* 已退出 */ }
    },
    proc,
  };
}
