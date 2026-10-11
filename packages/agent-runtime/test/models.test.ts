/**
 * 模型发现与校验。
 *
 * 重点锁两条：
 *  1. 三层来源的降级顺序（listModels → fetchModels → fallbackModels）与 source 标记
 *  2. **fallback 不是真清单** —— 有 live 缓存时必须校验用户选择
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_MODEL_OPTION,
  listAgentModels,
  rememberLiveModels,
  resolveModel,
  liveModelIds,
} from '../src/models.ts';
import { claudeConfiguredModels } from '../src/claude-env.ts';
import type { RuntimeDefinition } from '../src/defs.ts';

function def(overrides: Partial<RuntimeDefinition> = {}): RuntimeDefinition {
  return {
    id: 'claude-code',
    displayName: 'Fake',
    executable: 'definitely-not-on-path',
    probeArgs: ['--version'],
    parseLine: () => null,
    buildArgs: () => [],
    ...overrides,
  } as unknown as RuntimeDefinition;
}

describe('listAgentModels 三层降级', () => {
  it('listModels 成功 → source=live，且 DEFAULT 排最前', async () => {
    const d = def({
      // node -e '' 恒退出 0，parse 是桩、与 stdout 无关——测的是「成功后怎么归一」
      listModels: { args: ['-e', ''], parse: () => [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
      fallbackModels: [{ id: 'x', label: 'X' }],
    });
    const r = await listAgentModels(d, process.execPath);
    expect(r.source).toBe('live');
    expect(r.models[0]!.id).toBe(DEFAULT_MODEL_OPTION.id);
    expect(r.models.map((m) => m.id)).toEqual(['default', 'a', 'b']);
  });

  it('listModels 失败 → 降级到 fetchModels，仍是 live', async () => {
    const d = def({
      // spawn 一个必然失败的命令
      listModels: { args: ['--nope'], parse: () => [{ id: 'a', label: 'A' }] },
      fetchModels: async () => [{ id: 'from-fetch', label: 'FF' }],
      fallbackModels: [{ id: 'x', label: 'X' }],
    });
    const r = await listAgentModels(d, process.execPath);
    expect(r.source).toBe('live');
    expect(r.models.some((m) => m.id === 'from-fetch')).toBe(true);
    expect(r.reason).toContain('listModels 失败');
  });

  it('两层都失败 → source=fallback，只有兜底提示', async () => {
    const d = def({
      fetchModels: async () => { throw new Error('boom'); },
      fallbackModels: [{ id: 'x', label: 'X' }],
    });
    const r = await listAgentModels(d, 'node');
    expect(r.source).toBe('fallback');
    expect(r.models.map((m) => m.id)).toEqual(['default', 'x']);
    expect(r.reason).toContain('boom');
  });

  it('三层都没有 → 空清单（只有 DEFAULT），不抛错', async () => {
    const r = await listAgentModels(def(), 'node');
    expect(r.source).toBe('fallback');
    expect(r.models).toEqual([DEFAULT_MODEL_OPTION]);
  });

  it('去重：定义里重复的 id 只留一个', async () => {
    const d = def({ fetchModels: async () => [{ id: 'a', label: 'A1' }, { id: 'a', label: 'A2' }] });
    const r = await listAgentModels(d, 'node');
    expect(r.models.filter((m) => m.id === 'a')).toHaveLength(1);
  });
});

describe('resolveModel —— fallback 不是真清单', () => {
  it('default 恒放行且不产出模型', () => {
    expect(resolveModel('claude-code', 'default')).toEqual({ ok: true });
    expect(resolveModel('claude-code', '')).toEqual({ ok: true });
    expect(resolveModel('claude-code', null)).toEqual({ ok: true });
  });

  it('有 live 清单时，未知 id 被拒（否则 UI 会显示跑不了的模型）', () => {
    rememberLiveModels('codex', [{ id: 'known', label: 'K' }]);
    expect(resolveModel('codex', 'known')).toEqual({ ok: true, model: 'known' });
    const bad = resolveModel('codex', 'nope');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('nope');
  });

  it('无 live 清单时放行——没清单可对，别瞎拦', () => {
    expect(resolveModel('dsh', 'whatever')).toEqual({ ok: true, model: 'whatever' });
  });

  it('supportsCustomModel 时手填放行', () => {
    rememberLiveModels('claude-code', [{ id: 'known', label: 'K' }]);
    expect(resolveModel('claude-code', 'hand-typed', { supportsCustomModel: true }))
      .toEqual({ ok: true, model: 'hand-typed' });
  });

  it('liveModelIds 反映缓存', () => {
    rememberLiveModels('codex', [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    expect(liveModelIds('codex')).toEqual(['a', 'b']);
    expect(liveModelIds('never-seen')).toEqual([]);
  });
});

describe('claudeConfiguredModels 读 settings env', () => {
  function withHome(env: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-claude-home-'));
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ env }));
    return dir;
  }

  it('把 ANTHROPIC_DEFAULT_<ALIAS>_MODEL 翻成别名选项', () => {
    const home = withHome({
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5[1M]',
      ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-fable-5[1M]',
    });
    const models = claudeConfiguredModels(home);
    expect(models.map((m) => m.id).sort()).toEqual(['fable', 'opus']);
    // label 显示映射关系，免得用户以为在选真名
    expect(models.find((m) => m.id === 'opus')!.label).toContain('claude-opus-5[1M]');
  });

  it('有 _NAME 时把显示名也带进 label', () => {
    const home = withHome({
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5[1M]',
      ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'mimo-v2.6-pro',
    });
    expect(claudeConfiguredModels(home)[0]!.label).toContain('mimo-v2.6-pro');
  });

  it('没配任何模型 → 空数组（调用方据此降级到 fallback）', () => {
    expect(claudeConfiguredModels(withHome({ SOMETHING_ELSE: 'x' }))).toEqual([]);
    // 目录不存在也不抛错
    expect(claudeConfiguredModels(path.join(os.tmpdir(), 'mm-no-such-home-xyz'))).toEqual([]);
  });

  it('空值的映射被跳过', () => {
    const home = withHome({ ANTHROPIC_DEFAULT_OPUS_MODEL: '   ' });
    expect(claudeConfiguredModels(home)).toEqual([]);
  });
});
