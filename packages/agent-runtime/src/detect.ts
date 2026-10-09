/**
 * 探测本机装了哪些 agent CLI（OpenDesign 的 PATH 扫描模式）。
 *
 * 只看「能不能跑出版本」，不做网络探测、不改配置。
 * 探测失败不抛错——返回 usable=false，上层据此提示用户装哪个。
 */

import { spawnSync } from 'node:child_process';
import { RUNTIMES, type RuntimeDefinition } from './defs.ts';
import { resolveSpawnTarget } from './resolve.ts';

export interface DetectedRuntime {
  def: RuntimeDefinition;
  /** 解析出的版本串；探测不到为 null */
  version: string | null;
  /** 能被 buildArgs 使用 */
  usable: boolean;
  /** 登录预检结论（仅声明了 authProbe 的运行时会探测） */
  authStatus?: 'ok' | 'missing' | 'unknown';
  authMessage?: string;
}

/**
 * 把 authProbe 的输出归一成登录结论。
 * - claude auth status → JSON `{ loggedIn: boolean, authMethod? }`
 * - codex login status → 文本 "Logged in using ..."
 * 认不出措辞时不妄断：unknown 只是"没提示"，不影响 usable。
 */
export function classifyAuth(
  exitCode: number | null,
  output: string,
): { status: 'ok' | 'missing' | 'unknown'; message?: string } {
  const text = output.trim();
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text) as { loggedIn?: unknown; authMethod?: unknown };
      if (typeof j.loggedIn === 'boolean') {
        return j.loggedIn
          ? { status: 'ok', message: j.authMethod ? `已登录（${String(j.authMethod)}）` : '已登录' }
          : { status: 'missing', message: '未登录，请先在终端登录该 agent CLI' };
      }
    } catch {
      /* 不是 JSON，走文本匹配 */
    }
  }
  if (/not logged in|logged out|未登录|请.{0,4}登录|please run .*login|needs? (to )?log ?in/i.test(text)) {
    return { status: 'missing', message: text.split('\n')[0].slice(0, 80) };
  }
  if (/logged in/i.test(text)) {
    return { status: 'ok', message: text.split('\n')[0].slice(0, 80) };
  }
  return { status: 'unknown' };
}

export function detectRuntimes(candidates: RuntimeDefinition[] = RUNTIMES): DetectedRuntime[] {
  const out: DetectedRuntime[] = [];

  for (const def of candidates) {
    let version: string | null = null;
    let usable = false;
    let authStatus: DetectedRuntime['authStatus'];
    let authMessage: string | undefined;

    try {
      const target = resolveSpawnTarget(def.executable);
      const r = spawnSync(
        target?.command ?? def.executable,
        [...(target?.prefixArgs ?? []), ...def.probeArgs],
        { encoding: 'utf-8', timeout: 15_000, windowsHide: true },
      );
      const text = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
      if (text) {
        // 版本串取第一行前 60 字符，避免把整段帮助文本带出去
        version = text.split('\n')[0].trim().slice(0, 60);
        usable = true;
      }
      if (r.status === 0 && !version) usable = true;

      // 登录预检：只给装了且能跑的 CLI 发（声明了 authProbe 的才有）
      if (usable && def.authProbe) {
        const a = spawnSync(
          target?.command ?? def.executable,
          [...(target?.prefixArgs ?? []), ...def.authProbe.args],
          { encoding: 'utf-8', timeout: def.authProbe.timeoutMs ?? 5_000, windowsHide: true },
        );
        const cls = classifyAuth(a.status, `${a.stdout ?? ''}${a.stderr ?? ''}`);
        authStatus = cls.status;
        authMessage = cls.message;
      }
    } catch {
      // 不在 PATH 上，或无法启动
    }

    out.push({ def, version, usable, authStatus, authMessage });
  }

  return out;
}

/** 只返回可用的。 */
export function usableRuntimes(): DetectedRuntime[] {
  return detectRuntimes().filter((r) => r.usable);
}
