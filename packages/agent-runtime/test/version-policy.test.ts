/**
 * 版本策略（对齐 OpenDesign 的 RuntimeVersionPolicy）。
 *
 * 锁住的语义：
 * - parse 从各家版本行里抠出版本串（"2.1.296 (Claude Code)" → "2.1.296"）
 * - requireVersion 探不出版本 → **fail-closed** 拒启（宁可拒启也不带着错旗标跑）
 * - 版本在支持线外 → 仍可用，但给警告（rc 流靠发布线正则消掉周更警告，
 *   线外照样提——匹配线 ≠ 删除检查）
 * - 无策略时保持旧语义，不能把没接版本策略的运行时弄拒启
 */
import { describe, expect, it } from 'vitest';
import { claudeCode, codex, dsh, extractSemverish, type RuntimeVersionPolicy } from '../src/defs.ts';
import { versionGate, versionIsSupported } from '../src/detect.ts';

describe('extractSemverish — 三家的真实版本行', () => {
  it('claude "2.1.296 (Claude Code)" → 2.1.296', () => {
    expect(extractSemverish('2.1.296 (Claude Code)')).toBe('2.1.296');
  });
  it('codex "codex-cli 0.162.1" → 0.162.1', () => {
    expect(extractSemverish('codex-cli 0.162.1')).toBe('0.162.1');
  });
  it('dsh rc 流 "0.1.1-rc.1" 连后缀一起保留', () => {
    expect(extractSemverish('0.1.1-rc.1')).toBe('0.1.1-rc.1');
  });
  it('没有可解析版本 → null', () => {
    expect(extractSemverish('garbage output')).toBeNull();
    expect(extractSemverish('')).toBeNull();
  });
});

describe('各 def 的版本策略声明', () => {
  it('三家都声明了 requireVersion（fail-closed）', () => {
    for (const def of [claudeCode, codex, dsh]) {
      expect(def.versionPolicy?.requireVersion).toBe(true);
    }
  });
  it('发布线正则不带 g 旗标（RegExp.test 有状态，带 g 会支持/未验证来回跳）', () => {
    for (const def of [claudeCode, codex, dsh]) {
      expect(def.versionPolicy?.supportedVersionPattern?.flags ?? '').not.toContain('g');
    }
  });
  it('dsh 的 rc 发布线：同线 rc 不警告，出线警告', () => {
    const policy = dsh.versionPolicy!;
    expect(versionIsSupported(policy, '0.1.1-rc.1')).toBe(true);
    expect(versionIsSupported(policy, '0.1.1-rc.12')).toBe(true);
    expect(versionIsSupported(policy, '0.1.2-rc.1')).toBe(true);  // 同线换 rc
    expect(versionIsSupported(policy, '0.1.1')).toBe(false);   // 丢了 rc 段：出线
    expect(versionIsSupported(policy, '0.2.0-rc.1')).toBe(false); // 跨小版本可能换协议：出线
  });
  it('claude 2.x 线、codex 0.x 线各自匹配', () => {
    expect(versionIsSupported(claudeCode.versionPolicy!, '2.1.296')).toBe(true);
    expect(versionIsSupported(claudeCode.versionPolicy!, '3.0.0')).toBe(false);
    expect(versionIsSupported(codex.versionPolicy!, '0.162.1')).toBe(true);
    expect(versionIsSupported(codex.versionPolicy!, '0.200.9')).toBe(true);
    expect(versionIsSupported(codex.versionPolicy!, '1.0.0')).toBe(false);
  });
});

describe('versionGate', () => {
  const policy: RuntimeVersionPolicy = {
    supportedVersions: ['1.2.3'],
    supportedVersionPattern: /^1\.2\./,
    requireVersion: true,
    parse: extractSemverish,
  };

  it('无策略：旧语义——有输出即能跑，无输出但退出 0 也算', () => {
    expect(versionGate(undefined, 'v1', false)).toEqual({ version: 'v1', usable: true });
    expect(versionGate(undefined, null, true)).toEqual({ version: null, usable: true });
    expect(versionGate(undefined, null, false)).toEqual({ version: null, usable: false });
  });

  it('requireVersion 且探不出版本 → 拒启（fail-closed），带原因', () => {
    const gate = versionGate(policy, null, true);
    expect(gate.usable).toBe(false);
    expect(gate.warning).toContain('拒启');
  });

  it('requireVersion 且版本行解析不出 → 同样拒启', () => {
    const gate = versionGate(policy, 'garbage output', true);
    expect(gate.version).toBeNull();
    expect(gate.usable).toBe(false);
  });

  it('精确命中实测版本 → 可用、无警告', () => {
    expect(versionGate(policy, '1.2.3', true)).toEqual({ version: '1.2.3', usable: true });
  });

  it('命中发布线 → 可用、无警告（rc 流不周周报警）', () => {
    expect(versionGate(policy, '1.2.9', true)).toEqual({ version: '1.2.9', usable: true });
  });

  it('线外版本 → 仍可用，但警告里点名版本', () => {
    const gate = versionGate(policy, '9.9.9', true);
    expect(gate.usable).toBe(true);
    expect(gate.warning).toContain('9.9.9');
    expect(gate.warning).toContain('未验证');
  });
});
