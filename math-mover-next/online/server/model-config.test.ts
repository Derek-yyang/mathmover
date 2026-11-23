import { describe, expect, it } from 'vitest';
import { normalizeOnlineModelConfig, normalizeOnlineReasoningEffort } from '../model-config';

const valid = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'test-key',
  model: 'model-a',
  apiFormat: 'openai-chat',
} as const;

describe('online model config', () => {
  it('accepts a public HTTPS provider', () => {
    expect(normalizeOnlineModelConfig(valid)).toEqual(valid);
  });

  it.each([
    'http://localhost:3000/v1',
    'https://127.0.0.1/v1',
    'https://192.168.1.4/v1',
    'http://api.example.com/v1',
    'https://user:pass@api.example.com/v1',
  ])('rejects unsafe provider URL %s', (baseUrl) => {
    expect(() => normalizeOnlineModelConfig({ ...valid, baseUrl })).toThrow('公开的 HTTPS 地址');
  });

  it('rejects incomplete and unknown formats', () => {
    expect(() => normalizeOnlineModelConfig({ ...valid, apiKey: '' })).toThrow('请完整填写');
    expect(() => normalizeOnlineModelConfig({ ...valid, apiFormat: 'unknown' })).toThrow('API 格式');
  });

  it('always uses low for the hosted experience', () => {
    expect(normalizeOnlineReasoningEffort(undefined)).toBe('low');
    expect(normalizeOnlineReasoningEffort('unknown')).toBe('low');
    expect(normalizeOnlineReasoningEffort('low')).toBe('low');
    expect(normalizeOnlineReasoningEffort('high')).toBe('low');
    expect(normalizeOnlineReasoningEffort('max')).toBe('low');
  });
});
