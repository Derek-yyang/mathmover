/**
 * 异步子进程捕获（不经 shell）。
 *
 * 为什么要有这层：探测类调用（--version / auth / 值拒绝探针 / 模型发现）原先用
 * spawnSync——它**阻塞 Node 事件循环**，agent CLI 冷启动动辄数秒，十几个探测
 * 串起来能把整个服务冻住半分钟（2026-10-12 实测 44s，前端检测超时 20s 必挂）。
 * 统一走这里的异步版本，探测之间可以并行。
 */

import { spawn } from 'node:child_process';

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
  return new Promise((resolve) => {
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
}
