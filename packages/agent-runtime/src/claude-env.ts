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
