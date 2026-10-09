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
import { createInterface } from 'node:readline';
import type { AgentEvent, RuntimeDefinition } from './defs.ts';
import { resolveExecutable } from './resolve.ts';
import { withClaudeSettingsEnv } from './claude-env.ts';

export interface RunOptions {
  def: RuntimeDefinition;
  prompt: string;
  mcpConfigPath: string;
  cwd?: string;
  sessionId?: string;
  /** 多轮续接的会话 id（各家语法由 RuntimeDefinition 自己翻译） */
  resumeSessionId?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
  /** 单次运行的硬超时（毫秒）；超时杀进程并发 error 事件 */
  timeoutMs?: number;
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
  // argv 传 prompt 的预算守卫：宁可明着拒绝，不要 ENAMETOOLONG 崩 spawn
  const budget = opts.def.maxPromptArgBytes ?? 24_000;
  if (!opts.def.promptViaStdin && Buffer.byteLength(opts.prompt, 'utf-8') > budget) {
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
    prompt: opts.prompt,
    mcpConfigPath: opts.mcpConfigPath,
    sessionId: opts.sessionId,
    resumeSessionId: opts.resumeSessionId,
    extraArgs: opts.extraArgs,
  });

  // Windows 下 npm 全局装的是 .cmd 包装，必须走 shell 才能解析到
  const exe = resolveExecutable(opts.def.executable) ?? opts.def.executable;
  // claude --restricted 会忽略 settings.json 的 env 块（自定义通道的认证在那），
  // spawn 时补回去；显式进程环境优先。见 claude-env.ts。
  const spawnEnv = opts.def.id === 'claude-code'
    ? withClaudeSettingsEnv({ ...process.env, ...opts.env })
    : { ...process.env, ...opts.env };
  const proc = spawn(exe, args, {
    cwd: opts.cwd ?? process.cwd(),
    env: spawnEnv,
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;

  // prompt 通道：stdin 优先（绕 argv 长度上限），argv 模式直接关 stdin 防空等
  if (opts.def.promptViaStdin) {
    proc.stdin.write(opts.prompt);
  }
  proc.stdin.end();

  let sessionId: string | undefined = opts.sessionId;
  let cancelTimer: NodeJS.Timeout | undefined;

  const emitLine = (line: string) => {
    if (!line.trim()) return;
    const parsed = opts.def.parseLine(line);
    if (!parsed) return;
    for (const ev of Array.isArray(parsed) ? parsed : [parsed]) {
      if (ev.kind === 'session') sessionId = ev.sessionId;
      if (ev.kind === 'done' && ev.sessionId) sessionId = ev.sessionId;
      opts.onEvent(ev);
    }
  };

  // stdout / stderr 都按行切。stderr 里的非 JSON 行透传为 raw，便于诊断。
  const out = createInterface({ input: proc.stdout });
  const err = createInterface({ input: proc.stderr });
  out.on('line', emitLine);
  err.on('line', (l) => {
    const parsed = opts.def.parseLine(l);
    // stderr 里的非 JSON 行透传为 raw，便于诊断（如 unrecognized_model 警告）
    if (!parsed) {
      opts.onEvent({ kind: 'raw', line: l });
      return;
    }
    for (const ev of Array.isArray(parsed) ? parsed : [parsed]) opts.onEvent(ev);
  });

  if (opts.timeoutMs && opts.timeoutMs > 0) {
    cancelTimer = setTimeout(() => {
      opts.onEvent({ kind: 'error', message: `agent 运行超时（${opts.timeoutMs}ms）` });
      try { proc.kill(); } catch {}
    }, opts.timeoutMs);
  }

  const done = new Promise<{ exitCode: number | null; sessionId?: string }>((resolve) => {
    proc.on('error', (e) => {
      if (cancelTimer) clearTimeout(cancelTimer);
      opts.onEvent({ kind: 'error', message: `启动 ${opts.def.executable} 失败: ${e.message}` });
      resolve({ exitCode: null, sessionId });
    });
    proc.on('close', (code) => {
      if (cancelTimer) clearTimeout(cancelTimer);
      out.close();
      err.close();
      resolve({ exitCode: code, sessionId });
    });
  });

  return {
    done,
    cancel: () => {
      try { proc.kill(); } catch {}
    },
    proc,
  };
}
