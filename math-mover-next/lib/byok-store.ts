/**
 * 内置 Agent（OpenCode）的端点配置仓 —— **应用数据目录**（对齐 OpenDesign 的
 * 密钥模型：key 交给本机应用保管，界面只回显掩码）。
 *
 * 形态（桌面化前置）：配置存 <dataDir>/byok.json，与课件库同属用户的本机资产；
 * 读接口只返回 apiKeyConfigured + apiKeyTail（尾 4 位），**完整 key 永不回传**。
 * 课件备份只打包数据库及其引用资源（courseware-store.createBackup），
 * byok.json 天然不在备份包里——密钥不进备份介质。
 *
 * 2026-10-13 自浏览器 localStorage 迁来（该功能上线不足一天，无存量迁移）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveApiFormat, type ApiFormat } from '../../packages/agent-runtime/src/api-format.ts';

export interface ByokConfig {
  apiFormat: ApiFormat;
  baseUrl: string;
  apiKey: string;
  model: string;
  /**
   * 推理档位清单（用户手填，逗号分隔，如 `low,high`）。空 = 不提供档位。
   *
   * 为什么是手填：档位是各家 provider 私有的，端点上也读不到（`/models` 只给 id）。
   * 我们**不自造**一套通用档位，也不假装知道——用户按自己服务商的文档填，
   * 我们只负责把它变成请求体里的 `reasoning_effort`（通道见 opencode-config.ts）。
   */
  reasoningLevels: string;
}

/** 读接口的掩码形状——不含 key 本体。 */
export interface ByokConfigView {
  apiFormat: ApiFormat;
  baseUrl: string;
  model: string;
  reasoningLevels: string;
  apiKeyConfigured: boolean;
  apiKeyTail: string;
}

const FILE = 'byok.json';

export function loadByokConfig(root: string): ByokConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, FILE), 'utf-8')) as Partial<ByokConfig>;
    return {
      apiFormat: resolveApiFormat(raw.apiFormat),
      baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : '',
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
      model: typeof raw.model === 'string' ? raw.model : '',
      reasoningLevels: typeof raw.reasoningLevels === 'string' ? raw.reasoningLevels : '',
    };
  } catch {
    return null;
  }
}

export function maskByokConfig(config: ByokConfig | null): ByokConfigView {
  return {
    apiFormat: resolveApiFormat(config?.apiFormat),
    baseUrl: config?.baseUrl ?? '',
    model: config?.model ?? '',
    reasoningLevels: config?.reasoningLevels ?? '',
    apiKeyConfigured: !!config?.apiKey,
    apiKeyTail: config?.apiKey ? config.apiKey.slice(-4) : '',
  };
}

/**
 * 保存（整体替换；key 语义三态）：
 *   - 非空字符串 → 覆盖
 *   - 空串 / 不传  → **保留原 key**（编辑端点/模型时不必重填）
 *   - null        → **清除**（换人用/测试还原）
 * 返回保存后的掩码视图。
 */
export function saveByokConfig(root: string, next: Omit<Partial<ByokConfig>, 'apiKey'> & { apiKey?: string | null }): ByokConfigView {
  const prev = loadByokConfig(root);
  const merged: ByokConfig = {
    apiFormat: resolveApiFormat(next.apiFormat === undefined ? prev?.apiFormat : next.apiFormat),
    baseUrl: typeof next.baseUrl === 'string' ? next.baseUrl.trim() : (prev?.baseUrl ?? ''),
    apiKey: next.apiKey === null ? ''
      : typeof next.apiKey === 'string' && next.apiKey.trim() ? next.apiKey.trim() : (prev?.apiKey ?? ''),
    model: typeof next.model === 'string' ? next.model.trim() : (prev?.model ?? ''),
    reasoningLevels: typeof next.reasoningLevels === 'string' ? next.reasoningLevels.trim() : (prev?.reasoningLevels ?? ''),
  };
  fs.writeFileSync(path.join(root, FILE), JSON.stringify(merged), 'utf-8');
  return maskByokConfig(merged);
}

/** BYOK 是否可用：端点像 URL 且模型非空（key 可空——本地端点不需要）。 */
export function isByokRunnable(config: ByokConfig | null): config is ByokConfig {
  return !!config && /^https?:\/\//i.test(config.baseUrl.trim()) && !!config.model.trim();
}
