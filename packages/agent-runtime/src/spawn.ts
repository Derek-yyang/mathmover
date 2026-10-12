/**
 * 异步子进程捕获（不经 shell）。
 *
 * 为什么要有这层：探测类调用（--version / auth / 值拒绝探针 / 模型发现）原先用
 * spawnSync——它**阻塞 Node 事件循环**，agent CLI 冷启动动辄数秒，十几个探测
 * 串起来能把整个服务冻住半分钟（2026-10-12 实测 44s，前端检测超时 20s 必挂）。
 * 统一走这里的异步版本，探测之间可以并行。
 */

import { spawn } from 'node:child_process';

/**
 * 全局并发闸门：探测风暴会同时拉起十几个 agent CLI 冷启动（每个都是一整个
 * node 进程），Windows 上互相挤兑反而更慢，弱一点的探针（如 dsh --models）
 * 还会被拖过自己的超时而误降级（2026-10-12 实测）。限 4 路并发：既不 thrash，
 * 又比串行快得多。
 */
let active = 0;
const waiting: Array<() => void> = [];
const CONCURRENCY_LIMIT = 6;

function acquire(): Promise<void> | void {
  if (active < CONCURRENCY_LIMIT) { active += 1; return; }
  return new Promise<void>((resolve) => {
    waiting.push(() => { active += 1; resolve(); });
  });
}

function release(): void {
  active -= 1;
  waiting.shift()?.();
}

export interface CaptureResult {
  stdout: string;
  stderr: string;
  status: number | null;
  /** spawn 失败或超时为 true（此时 stdout/stderr 只含已捕获的部分） */
  failed: boolean;
}

export function spawnCapture(
  command: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CaptureResult> {
  const run = (): Promise<CaptureResult> => new Promise((resolve) => {
    let settled = false;
    const done = (result: CaptureResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(command, args, {
        env: opts.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      done({ stdout: '', stderr: '', status: null, failed: true });
      return;
    }
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* 已退出 */ }
      done({ stdout, stderr, status: null, failed: true });
    }, opts.timeoutMs ?? 15_000);
    timer.unref?.();
    proc.on('error', () => {
      clearTimeout(timer);
      done({ stdout, stderr, status: null, failed: true });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      done({ stdout, stderr, status: code, failed: false });
    });
    if (opts.input !== undefined) {
      try { proc.stdin?.end(opts.input); } catch { /* stdin 不可写 */ }
    } else {
      try { proc.stdin?.end(); } catch { /* stdin 不可写 */ }
    }
  });
  return (async () => {
    await acquire();
    try { return await run(); } finally { release(); }
  })();
}
