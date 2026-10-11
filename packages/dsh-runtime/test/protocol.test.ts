/**
 * 协议帧的解析与构造 —— 这层无 dsh 依赖，可独立测。
 *
 * 锁两条关键约束：
 *  1. `execute` 帧的必填字段与 model 的 `provider/id` 格式（宿主靠它对齐）
 *  2. images 项的校验：非法就整体丢弃（宁缺勿错，不悄悄塞半批图）
 */
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  RUNTIME_NAME,
  identityFrame,
  modelsFrame,
  parseHostCommand,
  type ModelCatalogEntry,
} from '../src/protocol.ts';

const base = {
  v: 1, type: 'execute', request_id: 'r1', cwd: 'D:/x', prompt: '画个圆', mcp_servers: [],
};

describe('parseHostCommand — execute 帧', () => {
  it('最小必填字段通过，可选字段缺席时不带上', () => {
    const cmd = parseHostCommand(base);
    expect(cmd).toEqual(base);
    expect('model' in cmd).toBe(false);
    expect('images' in cmd).toBe(false);
    expect('reasoning_effort' in cmd).toBe(false);
  });

  it('缺必填字段被拒（协议信封要严格）', () => {
    expect(() => parseHostCommand({ ...base, request_id: '' })).toThrow();
    expect(() => parseHostCommand({ ...base, cwd: '' })).toThrow();
    expect(() => parseHostCommand({ ...base, prompt: '' })).toThrow();
    expect(() => parseHostCommand({ ...base, mcp_servers: null })).toThrow();
    expect(() => parseHostCommand({ type: 'execute' })).toThrow();
  });

  it('model 必须是 provider/id 两段俱全', () => {
    expect(parseHostCommand({ ...base, model: { provider: 'p', id: 'm' } }).model)
      .toEqual({ provider: 'p', id: 'm' });
    expect(() => parseHostCommand({ ...base, model: { provider: '', id: 'm' } })).toThrow();
    expect(() => parseHostCommand({ ...base, model: { provider: 'p', id: '' } })).toThrow();
    expect(() => parseHostCommand({ ...base, model: 'p/m' })).toThrow();
  });

  it('reasoning_effort 与 resume_session_id 空串被拒', () => {
    expect(() => parseHostCommand({ ...base, reasoning_effort: '' })).toThrow();
    expect(() => parseHostCommand({ ...base, resume_session_id: '  ' })).toThrow();
    expect(parseHostCommand({ ...base, reasoning_effort: 'high' }).reasoning_effort).toBe('high');
  });

  it('cancel 帧只要 request_id', () => {
    expect(parseHostCommand({ v: 1, type: 'cancel', request_id: 'r1' }))
      .toEqual({ v: 1, type: 'cancel', request_id: 'r1' });
    expect(() => parseHostCommand({ v: 1, type: 'cancel' })).toThrow();
  });

  it('images：全合法才保留，任一项坏就整批丢弃', () => {
    const good = { mediaType: 'image/png', data: 'aGVsbG8=', name: 'x.png' };
    const ok = parseHostCommand({ ...base, images: [good] });
    expect(ok.images).toEqual([good]);

    // 缺 name 是允许的（name 可选）
    expect(parseHostCommand({ ...base, images: [{ mediaType: 'image/png', data: 'aGVsbG8=' }] }).images)
      .toEqual([{ mediaType: 'image/png', data: 'aGVsbG8=' }]);

    // 坏一项 → 整批丢弃（不悄悄塞半批）
    expect(parseHostCommand({ ...base, images: [good, { mediaType: 'image/png', data: '' }] }).images).toBeUndefined();
    expect(parseHostCommand({ ...base, images: [{ data: 'x' }] }).images).toBeUndefined();
    expect(parseHostCommand({ ...base, images: [] }).images).toBeUndefined();
    expect(parseHostCommand({ ...base, images: 'not-an-array' }).images).toBeUndefined();
  });
});

describe('下行帧构造', () => {
  const models: ModelCatalogEntry[] = [{
    provider: 'p', provider_name: 'P', id: 'm', name: 'M',
    reasoning_options: [{ id: 'high', name: 'High', default: true }],
  }];

  it('modelsFrame 带 protocol 版本与 runtime 标识', () => {
    const f = modelsFrame(models);
    expect(f.v).toBe(PROTOCOL_VERSION);
    expect(f.runtime).toBe(RUNTIME_NAME);
    expect(f.models).toEqual(models);
  });

  it('identityFrame 的 probe/ready 与 capabilities', () => {
    for (const type of ['probe', 'ready'] as const) {
      const f = identityFrame(type, '1.2.3');
      expect(f.type).toBe(type);
      expect(f.runtime).toBe(RUNTIME_NAME);
      expect(f.protocol_version).toBe(PROTOCOL_VERSION);
      expect(f.plugin_version).toBe('1.2.3');
      expect(f.capabilities).toMatchObject({ session_resume: true, session_cancel: true, structured_events: true });
    }
  });

  it('runtime 标识是 mathmover（fork 改名的落点）', () => {
    expect(RUNTIME_NAME).toBe('mathmover');
  });
});
