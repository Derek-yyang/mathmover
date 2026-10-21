/**
 * `OPENCODE_CONFIG_CONTENT` 组装 —— 形状对齐 2026-10-18 实测（本机 1.19.3）：
 * provider/mcp/environment/permission 四个键都验过真的生效。
 */

import { describe, it, expect } from 'vitest';
import {
  buildOpenCodeConfigContent,
  DEFAULT_REASONING_LEVELS,
  effectiveReasoningLevels,
  normalizeReasoningLevels,
  opencodeModelId,
  REASONING_LEVEL_VOCABULARY,
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
  it.each([
    ['openai-chat', '@ai-sdk/openai-compatible'],
    ['openai-responses', '@ai-sdk/openai'],
    ['anthropic', '@ai-sdk/anthropic'],
    ['gemini', '@ai-sdk/google'],
  ] as const)('uses the %s SDK, while preserving the supplied base URL and env key', (apiFormat, npm) => {
    const source = buildOpenCodeConfigContent({ provider: { ...provider, apiFormat } });
    const entry = parse(source).provider[OPENCODE_BYOK_PROVIDER_ID];
    expect(entry.npm).toBe(npm);
    expect(entry.options.baseURL).toBe(provider.baseUrl);
    expect(entry.options.apiKey).toBe(`{env:${OPENCODE_BYOK_API_KEY_ENV}}`);
    expect(source).not.toContain(provider.apiKey);
  });

  it('does not silently fall back on an unsupported format', () => {
    expect(() => buildOpenCodeConfigContent({ provider: { ...provider, apiFormat: 'unknown' as any } })).toThrow('接口格式');
  });

  it('档位：每个值声明成一个 variant（`--variant <值>` 时并进请求体）', () => {
    const cfg = parse(buildOpenCodeConfigContent({ provider: { ...provider, reasoningLevels: ['low', 'high'] }, mcp }));
    expect(cfg.provider[OPENCODE_BYOK_PROVIDER_ID].models['deepseek-v3'].variants).toEqual({
      low: { reasoningEffort: 'low' },
      high: { reasoningEffort: 'high' },
    });
  });

  it('档位默认：空配置 = 默认那三个（与 opencode 自己的默认一致），不是"没有档位"', () => {
    expect(effectiveReasoningLevels('')).toEqual([...DEFAULT_REASONING_LEVELS]);
    expect(effectiveReasoningLevels(undefined)).toEqual([...DEFAULT_REASONING_LEVELS]);
    expect(effectiveReasoningLevels('   ')).toEqual(['low', 'medium', 'high']);
    expect(effectiveReasoningLevels('xhigh')).toEqual(['xhigh']);
    expect(effectiveReasoningLevels('none')).toEqual(['none']);
    // 按词汇表顺序排：点阵的顺序不该取决于点击先后
    expect(effectiveReasoningLevels('high,minimal,low')).toEqual(['minimal', 'low', 'high']);
    // 词表外的值（老配置/自填）原序接在后面，不丢
    expect(effectiveReasoningLevels('high,turbo')).toEqual(['high', 'turbo']);
    // 词汇表取自 opencode 自己的档位集合
    expect([...REASONING_LEVEL_VOCABULARY]).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(DEFAULT_REASONING_LEVELS).toEqual(['low', 'medium', 'high']);
  });

  it('档位：不填就不声明 variants（别给自造 provider 编一套档位）', () => {
    for (const levels of [undefined, [] as string[]]) {
      const cfg = parse(buildOpenCodeConfigContent({ provider: { ...provider, reasoningLevels: levels }, mcp }));
      expect(cfg.provider[OPENCODE_BYOK_PROVIDER_ID].models['deepseek-v3'].variants).toBeUndefined();
    }
  });

  it('normalizeReasoningLevels：去空白/去重，形状不合的丢掉（它要当 JSON 键与命令行参数）', () => {
    expect(normalizeReasoningLevels([' low ', 'high', 'high', '', 'bad value!', 'x'.repeat(40), 'gpt-5.1-mini']))
      .toEqual(['low', 'high', 'gpt-5.1-mini']);
    expect(normalizeReasoningLevels(undefined)).toEqual([]);
  });

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
