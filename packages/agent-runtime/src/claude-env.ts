/**
 * 读取 Claude Code 用户配置里的 env 块（~/.claude/settings.json + settings.local.json）。
 *
 * 背景（2026-10-09 实测）：`claude --restricted` 的语义是「移除能跑命令/代码的内置工具，
 * 并**忽略用户/项目 settings**」——settings.json 的 env 块（自定义模型通道的
 * ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL / 模型映射就配在这里）因此**不会被应用**，
 * 无进程级认证的机器上 spawn 出的 claude 会直接 "Not logged in"。
 * 产品必须保留 --restricted（Bash 等必须禁掉；--allowedTools 只是放行白名单、不拦截，
 * 实测 Bash 照样能跑），所以由我们在 spawn 时把这个 env 块补回去。
 *
 * 语义：**只填空缺**——进程环境里已有同名变量（含空串以外的显式值）则以进程为准，
 * 与「显式覆盖配置」的直觉一致。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RuntimeModelOption } from './defs.ts';

function readEnvBlock(file: string): Record<string, string> {
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const env = cfg?.env;
    if (env && typeof env === 'object' && !Array.isArray(env)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch {
    /* 文件不存在/损坏：跳过 */
  }
  return {};
}

/**
 * 合并 ~/.claude/settings.json 与 settings.local.json 的 env 块（后者覆盖前者）。
 * @param homeDir 测试注入用，默认 os.homedir()
 */
export function claudeSettingsEnv(homeDir?: string): Record<string, string> {
  const home = homeDir ?? os.homedir();
  const dir = path.join(home, '.claude');
  return {
    ...readEnvBlock(path.join(dir, 'settings.json')),
    ...readEnvBlock(path.join(dir, 'settings.local.json')),
  };
}

/**
 * 从 settings env 里读出「已配好的模型」。
 *
 * 自定义通道的映射形如：
 *   ANTHROPIC_DEFAULT_OPUS_MODEL      = "claude-opus-5[1M]"   ← 真实模型 id
 *   ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = "mimo-v2.6-pro"       ← 显示名（可选）
 *
 * `claude --model` 收的是**别名**（opus/fable/haiku/sonnet），所以 id 取别名，
 * label 把映射关系显示出来（如 `Opus → claude-opus-5[1M]`），免得用户以为在选真名。
 *
 * 没有任何映射时返回空数组——调用方据此降级到 fallbackModels（那是提示，不是真清单）。
 */
export function claudeConfiguredModels(homeDir?: string): RuntimeModelOption[] {
  const env = claudeSettingsEnv(homeDir);
  const out: RuntimeModelOption[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    const m = /^ANTHROPIC_DEFAULT_([A-Z0-9]+)_MODEL$/.exec(key);
    if (!m) continue;
    const alias = m[1].toLowerCase();
    if (!alias || seen.has(alias) || !String(value).trim()) continue;
    seen.add(alias);
    const display = env[`ANTHROPIC_DEFAULT_${m[1]}_MODEL_NAME`];
    const nice = alias.charAt(0).toUpperCase() + alias.slice(1);
    out.push({
      id: alias,
      label: display && display !== value ? `${nice} → ${value}（${display}）` : `${nice} → ${value}`,
    });
  }
  return out;
}

/**
 * settings 的全局推理档位默认（`effortLevel`，settings.local.json 覆盖）。
 * 这是 agent 自己配置里生效的档位——UI 的默认标记取它，不自造默认。
 * 读不到返回 null（UI 不标默认，让 agent 用自己的内置默认）。
 */
export function claudeDefaultEffort(homeDir?: string): string | null {
  const home = homeDir ?? os.homedir();
  const dir = path.join(home, '.claude');
  const read = (file: string): string | null => {
    try {
      const v = (JSON.parse(fs.readFileSync(file, 'utf-8')) as { effortLevel?: unknown })?.effortLevel;
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    } catch {
      return null;
    }
  };
  return read(path.join(dir, 'settings.local.json')) ?? read(path.join(dir, 'settings.json'));
}

/** 把 settings env 填进 spawn 环境：processEnv 显式设置的优先，settings 只补空缺。 */
export function withClaudeSettingsEnv(
  processEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
  homeDir?: string,
): NodeJS.ProcessEnv {
  const settings = claudeSettingsEnv(homeDir);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) out[k] = v;
  for (const [k, v] of Object.entries(processEnv)) {
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out as NodeJS.ProcessEnv;
}
