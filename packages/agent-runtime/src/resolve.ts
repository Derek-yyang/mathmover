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
import os from 'node:os';
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

/**
 * 按「主可执行名 + 兜底分叉名」（fallbackBins，对齐 OpenDesign）解析 spawn 目标：
 * 逐名试 resolveSpawnTarget，取第一个解析出的。分叉（如 openclaude）旗标集
 * 可能不同——能不能用由值拒绝探针（capabilities.ts）另判，这里只管找得到。
 *
 * 解析顺序（对齐 OpenDesign 的 inspectAgentExecutableResolution）：
 *   1. 显式覆盖 `*_BIN` 环境变量（CLAUDE_BIN / CODEX_BIN / DSH_BIN）——
 *      用户明示的选择，指哪打哪；**坏了如实不可用**，绝不静默回退 PATH
 *      （宁可报“没检测到”，也不悄悄换成另一个二进制）
 *   2. PATH（executable + fallbackBins 逐名）
 *   3. Codex 桌面 app bundle（macOS 专属兜底，排最低——npm/Homebrew 装的永远优先）
 */
const AGENT_BIN_ENV_KEYS: Record<string, string> = {
  'claude-code': 'CLAUDE_BIN',
  codex: 'CODEX_BIN',
  dsh: 'DSH_BIN',
};

/** 该 agent 的 *_BIN 环境变量名（诊断/引导 UI 用）。 */
export function agentBinEnvKey(id?: string): string | null {
  return (id && AGENT_BIN_ENV_KEYS[id]) || null;
}

/** 把一个已存在的文件路径变成 spawn 目标（.cmd shim 解析同主逻辑）；不存在 → null。 */
function spawnTargetFromFile(filePath: string, label: string): SpawnTarget | null {
  if (!fs.existsSync(filePath)) return null;
  if (IS_WIN) {
    if (/\.(exe|com)$/i.test(filePath)) return { command: filePath, prefixArgs: [], label };
    if (/\.(cmd|bat)$/i.test(filePath)) {
      const entry = findEntryInCmdShim(filePath);
      if (entry?.kind === 'exe') return { command: entry.path, prefixArgs: [], label };
      if (entry?.kind === 'js') return { command: process.execPath, prefixArgs: [entry.path], label };
      return { command: filePath, prefixArgs: [], label };
    }
    return { command: filePath, prefixArgs: [], label };
  }
  return { command: filePath, prefixArgs: [], label };
}

/**
 * Codex 桌面 app bundle 的内置 CLI（macOS 专属：`Codex.app/Contents/Resources/codex`；
 * Windows 没有对应的独立安装形态）。只装了 app 没装 CLI 的用户靠它被发现。
 * 导出供测试断言候选路径——顺序错了不该默默回归。
 */
export function codexAppBundleCandidates(): string[] {
  if (process.platform !== 'darwin') return [];
  const home = os.homedir();
  const suffix = path.join('Codex.app', 'Contents', 'Resources', 'codex');
  return [path.join(home, 'Applications', suffix), path.join('/Applications', suffix)];
}

function codexAppBundleTarget(id: string | undefined): SpawnTarget | null {
  if (id !== 'codex') return null;
  for (const candidate of codexAppBundleCandidates()) {
    const target = spawnTargetFromFile(candidate, 'codex');
    if (target) return target;
  }
  return null;
}

export function resolveRuntimeTarget(def: {
  id?: string;
  executable: string;
  fallbackBins?: string[];
}): SpawnTarget | null {
  const envKey = agentBinEnvKey(def.id);
  const override = envKey ? process.env[envKey]?.trim() : undefined;
  if (override) {
    // 显式选择不做 PATH 回退：指错了就如实不可用（不静默换二进制）
    return spawnTargetFromFile(path.resolve(override), def.executable);
  }
  for (const name of [def.executable, ...(def.fallbackBins ?? [])]) {
    const target = resolveSpawnTarget(name);
    if (target) return target;
  }
  return codexAppBundleTarget(def.id);
}
