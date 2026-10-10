/**
 * 解析「怎么启动某个 CLI」——给出**不经 shell** 的 spawn 目标。
 *
 * 为什么需要这层（Windows 的真实坑）：
 *   - npm 全局装出来的是 `claude.cmd` 包装脚本 + 一个 bash shim（无扩展名）
 *   - Node 的 `spawn` 无 shell 时拒绝跑 `.cmd`（EINVAL）；开 `shell:true` 又把
 *     参数直接拼进命令行 → **命令注入**（Node 自己给 DEP0190 弃用警告）。
 *
 * 正解：解析 `.cmd` shim 里真正被调用的 `.js` 入口，改成
 *   spawn(process.execPath, [jsEntry, ...args])
 * 参数始终走 argv 数组、不经 shell 解析——用户输入里的 `; rm -rf /` 只会是字面量。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const IS_WIN = process.platform === 'win32';

/**
 * **注意：不要只取 `command` 就去 spawn。**
 * `.js` 入口的场景 `command` 是 node、脚本路径在 `prefixArgs` 里——
 * 只拿 command 等于 spawn 了个空 node（曾经真出过这个 bug，故不留
 * 「只给可执行路径」的便捷函数，免得再被误用）。
 */
export interface SpawnTarget {
  /** 真正要启动的可执行文件 */
  command: string;
  /** 需要插在用户参数之前的固定参数（如 node 的脚本路径） */
  prefixArgs: string[];
  /** 展示用的原始命令名 */
  label: string;
}

const cache = new Map<string, SpawnTarget | null>();

/**
 * 从 npm 的 `.cmd` shim 里抠出真正被调用的入口。
 *
 * 实测见过两种形态：
 *   claude.cmd → "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe" %*
 *   codex.cmd  → "%_prog%" "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
 * 所以要同时支持 .exe（直接 spawn）与 .js/.cjs（spawn node + 脚本）。
 */
function findEntryInCmdShim(cmdPath: string): { kind: 'exe' | 'js'; path: string } | null {
  try {
    const text = fs.readFileSync(cmdPath, 'utf-8');
    const dir = path.dirname(cmdPath);

    // 不绑定 %dp0% 这一种写法——直接找所有被引号包起来、以可执行扩展名结尾的串。
    const quoted = text.match(/"[^"]+\.(?:exe|com|js|cjs)"/gi) ?? [];

    for (const token of quoted) {
      const raw = token.slice(1, -1);            // 去掉首尾引号
      // %dp0% 是 cmd 的「当前脚本目录」变量，换成实际目录
      const expanded = raw.replace(/%dp0%/gi, dir);
      // 只接受落在 shim 目录下的路径，避免误认系统命令
      const normalized = path.normalize(expanded);
      if (!normalized.toLowerCase().startsWith(dir.toLowerCase())) continue;
      if (!fs.existsSync(normalized)) continue;

      return /\.(exe|com)$/i.test(normalized)
        ? { kind: 'exe', path: normalized }
        : { kind: 'js', path: normalized };
    }
    return null;
  } catch {
    return null;
  }
}

function rawWhich(name: string): string[] {
  const finder = IS_WIN ? 'where' : 'which';
  try {
    const r = spawnSync(finder, [name], {
      encoding: 'utf-8',
      timeout: 10_000,
      windowsHide: true,
    });
    return (r.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function resolveSpawnTarget(name: string): SpawnTarget | null {
  if (cache.has(name)) return cache.get(name)!;

  const candidates = rawWhich(name);
  let result: SpawnTarget | null = null;

  if (IS_WIN) {
    // 优先 .exe/.com（可直接 spawn）；退而求其次解析 .cmd shim 的 JS 入口
    const direct = candidates.find((c) => /\.(exe|com)$/i.test(c));
    if (direct) {
      result = { command: direct, prefixArgs: [], label: name };
    } else {
      const cmd = candidates.find((c) => /\.(cmd|bat)$/i.test(c));
      const entry = cmd ? findEntryInCmdShim(cmd) : null;
      if (entry?.kind === 'exe') {
        result = { command: entry.path, prefixArgs: [], label: name };
      } else if (entry?.kind === 'js') {
        result = { command: process.execPath, prefixArgs: [entry.path], label: name };
      } else if (cmd) {
        // 兜底：.cmd 但抠不出入口 —— 只能过 shell，调用方需自行保证参数安全
        result = { command: cmd, prefixArgs: [], label: name };
      }
    }
  } else {
    if (candidates[0]) result = { command: candidates[0], prefixArgs: [], label: name };
  }

  cache.set(name, result);
  return result;
}

export function clearResolveCache(): void {
  cache.clear();
}
