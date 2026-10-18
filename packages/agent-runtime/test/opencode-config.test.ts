/**
 * `OPENCODE_CONFIG_CONTENT` 组装 —— 形状对齐 2026-10-18 实测（本机 1.19.3）：
 * provider/mcp/environment/permission 四个键都验过真的生效。
 */

import { describe, it, expect } from 'vitest';
import {
  buildOpenCodeConfigContent,
  opencodeModelId,
  OPENCODE_BYOK_API_KEY_ENV,
  OPENCODE_BYOK_PROVIDER_ID,
} from '../src/opencode-config.ts';

const provider = { baseUrl: 'https://api.example.com/v1', model: 'deepseek-v3', apiKey: 'sk-secret' };
const mcp = { command: 'C:/node/node.exe', args: ['C:/repo/packages/daemon/src/mcp-stdio.ts'], env: { MATHMOVER_DAEMON_URL: 'http://127.0.0.1:8788' } };

const parse = (s: string | null) => JSON.parse(s!) as Record<string, any>;

describe('opencodeModelId', () => {
  it('加 provider 前缀，已带则不重复加', () => {
    expect(opencodeModelId('deepseek-v3')).toBe(`${OPENCODE_BYOK_PROVIDER_ID}/deepseek-v3`);
    expect(opencodeModelId(`${OPENCODE_BYOK_PROVIDER_ID}/deepseek-v3`)).toBe(`${OPENCODE_BYOK_PROVIDER_ID}/deepseek-v3`);
    expect(opencodeModelId('   ')).toBe('');
  });
});

describe('buildOpenCodeConfigContent', () => {
  it('provider：OpenAI 兼容包 + baseURL + 密钥走 {env:…} 引用（不落明文）', () => {
    const cfg = parse(buildOpenCodeConfigContent({ provider, mcp }));
    const entry = cfg.provider[OPENCODE_BYOK_PROVIDER_ID];
    expect(entry.npm).toBe('@ai-sdk/openai-compatible');
    expect(entry.options.baseURL).toBe('https://api.example.com/v1');
    expect(entry.options.apiKey).toBe(`{env:${OPENCODE_BYOK_API_KEY_ENV}}`);
    expect(JSON.stringify(cfg)).not.toContain('sk-secret');
    expect(entry.models['deepseek-v3'].modalities.input).toEqual(['text', 'image']);
  });

  it('端点根的去尾斜杠与本地端点无密钥两种情形', () => {
    const cfg = parse(buildOpenCodeConfigContent({ provider: { ...provider, baseUrl: 'http://127.0.0.1:15721/v1/', apiKey: '' }, mcp }));
    const entry = cfg.provider[OPENCODE_BYOK_PROVIDER_ID];
    expect(entry.options.baseURL).toBe('http://127.0.0.1:15721/v1');
    expect(entry.options.apiKey).toBeUndefined();
  });

  it('mcp：local + command 数组 + environment（实测这个键才把 env 传进子进程）', () => {
    const cfg = parse(buildOpenCodeConfigContent({ provider, mcp }));
    expect(cfg.mcp.mathmover.type).toBe('local');
    expect(cfg.mcp.mathmover.enabled).toBe(true);
    expect(cfg.mcp.mathmover.command).toEqual([mcp.command, ...mcp.args]);
    expect(cfg.mcp.mathmover.environment).toEqual({ MATHMOVER_DAEMON_URL: 'http://127.0.0.1:8788' });
  });

  it('permission 恒收紧 bash（实测模型连这个工具都看不到，且不会被 skip-permissions 绕过）', () => {
    const cfg = parse(buildOpenCodeConfigContent({ provider, mcp }));
    expect(cfg.permission).toEqual({ bash: 'deny' });
  });

  it('provider 或 mcp 缺一个也照样出配置；两个都没有 → null（不拿空对象覆盖用户全局配置）', () => {
    expect(parse(buildOpenCodeConfigContent({ provider, mcp: null })).mcp).toBeUndefined();
    expect(parse(buildOpenCodeConfigContent({ provider: null, mcp })).provider).toBeUndefined();
    expect(buildOpenCodeConfigContent({})).toBeNull();
    expect(buildOpenCodeConfigContent({ provider: null, mcp: null })).toBeNull();
  });

  it('半截配置不当成配置（无 baseUrl / 无模型 / 无 command 都组不出来）', () => {
    expect(buildOpenCodeConfigContent({ provider: { ...provider, baseUrl: '' }, mcp: null })).toBeNull();
    expect(buildOpenCodeConfigContent({ provider: { ...provider, model: '' }, mcp: null })).toBeNull();
    expect(buildOpenCodeConfigContent({ provider: null, mcp: { command: '  ', args: [] } })).toBeNull();
  });
});
