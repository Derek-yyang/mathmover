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
  resolveEffort,
  resolveModel,
} from '../src/models.ts';
import { claudeConfiguredModels, claudeDefaultEffort } from '../src/claude-env.ts';
import { codex, readCodexConfiguredModels, parseClaudeEffortValues, DEFAULT_MODEL_OPTION as DEF_DEFAULT, type RuntimeDefinition } from '../src/defs.ts';

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

  it('手填的未知 id 也拒——产品裁决 2026-10-12：清单以 agent 配置为唯一真相，不留手填入口', () => {
    rememberLiveModels('claude-code', [{ id: 'known', label: 'K' }]);
    const bad = resolveModel('claude-code', 'hand-typed');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('改该 Agent 自己的配置');
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

describe('codex 模型发现 — config.toml + model_catalog_json 目录', () => {
  /** 造 ~/.codex：config.toml 正文 + 可选的目录文件（形状取自 cc-switch）。 */
  function withCodexHome(config: string, catalog?: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-codex-home-'));
    fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), config, 'utf-8');
    if (catalog !== undefined) {
      fs.writeFileSync(path.join(dir, '.codex', 'cc-switch-model-catalog.json'), JSON.stringify(catalog), 'utf-8');
    }
    return dir;
  }

  it('目录里的模型用 display_name 展示（与本机 TUI /model 一致，2026-10-12 实测）', () => {
    const home = withCodexHome(
      'model = "gpt-6.1-sol"\nmodel_catalog_json = "cc-switch-model-catalog.json"\n',
      { models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', description: 'workhorse' }] },
    );
    expect(readCodexConfiguredModels(home)).toEqual([{ id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' }]);
  });

  it('已配好的模型不在目录里也补上（label 标明来源）', () => {
    const home = withCodexHome(
      'model = "custom-x"\nmodel_catalog_json = "cc-switch-model-catalog.json"\n',
      { models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol' }] },
    );
    expect(readCodexConfiguredModels(home)).toEqual([
      { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' },
      { id: 'custom-x', label: 'custom-x（config.toml）' },
    ]);
  });

  it('目录缺失/损坏：退回只列已配好的那个，宁缺勿编', () => {
    const missing = withCodexHome('model = "gpt-6.1-sol"\nmodel_catalog_json = "gone.json"\n');
    expect(readCodexConfiguredModels(missing)).toEqual([{ id: 'gpt-6.1-sol', label: 'gpt-6.1-sol（config.toml）' }]);
    const broken = withCodexHome('model = "gpt-6.1-sol"\nmodel_catalog_json = "cc-switch-model-catalog.json"\n');
    fs.writeFileSync(path.join(broken, '.codex', 'cc-switch-model-catalog.json'), '{oops', 'utf-8');
    expect(readCodexConfiguredModels(broken)).toEqual([{ id: 'gpt-6.1-sol', label: 'gpt-6.1-sol（config.toml）' }]);
  });

  it('config 读不到 → 空数组（调用方降级到 fallback）', () => {
    expect(readCodexConfiguredModels(path.join(os.tmpdir(), 'mm-no-such-home-xyz'))).toEqual([]);
    expect(readCodexConfiguredModels(withCodexHome('nothing here\n'))).toEqual([]);
  });

  it('codex 的 fallback 只剩「默认」——硬编码假名会误导真实环境（已踩）', () => {
    expect(codex.fallbackModels).toEqual([DEF_DEFAULT]);
  });

  it('档位清单取自目录的 supported_reasoning_levels，默认标记取 config 的 model_reasoning_effort', () => {
    const home = withCodexHome(
      'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "high"\nmodel_catalog_json = "cc-switch-model-catalog.json"\n',
      { models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', default_reasoning_level: 'low',
        supported_reasoning_levels: [
          { effort: 'low', description: 'Fast responses' },
          { effort: 'medium', description: 'Balanced' },
          { effort: 'high', description: 'Deeper' },
        ] }] },
    );
    const [m] = readCodexConfiguredModels(home);
    expect(m!.reasoningOptions?.map((o) => o.id)).toEqual(['low', 'medium', 'high']);
    // 用户 config 里实际生效的 high 被标默认，不是目录的 low
    expect(m!.reasoningOptions?.find((o) => o.default)?.id).toBe('high');
  });

  it('config 档位不在该模型档位集里 → 退回目录的 default_reasoning_level', () => {
    const home = withCodexHome(
      'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "ultra"\nmodel_catalog_json = "cc-switch-model-catalog.json"\n',
      { models: [{ slug: 'gpt-6.1-sol', default_reasoning_level: 'low',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] }] },
    );
    expect(readCodexConfiguredModels(home)[0]!.reasoningOptions?.find((o) => o.default)?.id).toBe('low');
  });

  it('目录里没有档位信息 → 不造档位（选择器自然不出现）', () => {
    const home = withCodexHome(
      'model = "gpt-6.1-sol"\nmodel_catalog_json = "cc-switch-model-catalog.json"\n',
      { models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol' }] },
    );
    expect(readCodexConfiguredModels(home)[0]!.reasoningOptions).toBeUndefined();
  });

  /** cc-switch 按账号缓存的官方模型目录（桌面端「推荐模型集」的出处）。 */
  function withCcSwitch(home: string, accounts: unknown): string {
    const dir = path.join(home, '.cc-switch');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'codex-official-models.json'), JSON.stringify(accounts), 'utf-8');
    return home;
  }

  it('cc-switch 官方目录：与桌面端「推荐模型集」一致（跟着 ccswitch 走）', () => {
    const home = withCcSwitch(withCodexHome('model = "gpt-6-luna"\n'), {
      'account-1': {
        client_version: '0.162.0',
        models: [
          { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', default_reasoning_level: 'low',
            supported_reasoning_levels: [{ effort: 'low', description: 'x' }, { effort: 'high', description: 'y' }] },
          { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', default_reasoning_level: 'medium',
            supported_reasoning_levels: ['low', 'medium', 'high'] },
        ],
      },
    });
    const models = readCodexConfiguredModels(home);
    expect(models.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'gpt-6-luna']);
    // 对象与纯字符串两种 levels 形状都能吃；默认标记取条目的 default
    expect(models[0]!.reasoningOptions?.map((o) => o.id)).toEqual(['low', 'high']);
    expect(models[1]!.reasoningOptions?.find((o) => o.default)?.id).toBe('medium');
    // config 配的那个就在目录里：去重后只留一条（不重复补列）
    expect(models.filter((m) => m.id === 'gpt-6-luna').length).toBe(1);
  });

  it('三源合并去重：官方目录先到先得，config 的 model 兜底补列', () => {
    const home = withCcSwitch(
      withCodexHome('model = "solo"\nmodel_catalog_json = "cc-switch-model-catalog.json"\n', {
        models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol（别处来的）' }, { slug: 'extra', display_name: 'Extra' }],
      }),
      { 'account-1': { models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol' }] } },
    );
    const models = readCodexConfiguredModels(home);
    expect(models.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'extra', 'solo']);
    // 冲突时官方目录先到先得
    expect(models[0]!.label).toBe('GPT-6.1-Sol');
    expect(models.at(-1)!.label).toBe('solo（config.toml）');
  });
});

describe('claude 推理档位 — 枚举与默认都取自 agent 自己的配置', () => {
  it('parseClaudeEffortValues 解析假值报错的 Valid values 枚举（实测 2.1.296 形状）', () => {
    const text = "Warning: Unknown --effort value 'bogus' — ignoring it and using the default effort. " +
      'Valid values: low, medium, high, xhigh, max.\n' +
      'Error: Input must be provided either through stdin or as a prompt argument when using --print';
    expect(parseClaudeEffortValues(text)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(parseClaudeEffortValues('error: unexpected argument')).toBeNull();
    expect(parseClaudeEffortValues('')).toBeNull();
  });

  it('默认档读 settings 的 effortLevel（local 覆盖全局）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-claude-effort-'));
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ effortLevel: 'high' }));
    expect(claudeDefaultEffort(dir)).toBe('high');
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ effortLevel: 'max' }));
    expect(claudeDefaultEffort(dir)).toBe('max');
    expect(claudeDefaultEffort(path.join(os.tmpdir(), 'mm-no-such-home-xyz'))).toBeNull();
  });
});

describe('listAgentModels 合并运行时级档位 + resolveEffort 校验', () => {
  const fake = (extra: Partial<RuntimeDefinition> = {}) => ({
    id: 'fake-cli',
    displayName: 'Fake',
    executable: 'no-such-bin',
    probeArgs: ['--version'],
    parseLine: () => null,
    buildArgs: () => [],
    ...extra,
  }) as unknown as RuntimeDefinition;

  it('没自带档位的行（含默认行）合并运行时级档位；模型自带的以模型为准', async () => {
    const def = fake({
      fetchModels: async () => [
        { id: 'plain', label: 'Plain' },
        { id: 'rich', label: 'Rich', reasoningOptions: [{ id: 'own', label: 'own' }] },
      ],
      fetchReasoningOptions: async () => [{ id: 'low', label: 'low', default: true }],
    });
    const listing = await listAgentModels(def, 'no-such-bin');
    const byId = new Map(listing.models.map((m) => [m.id, m]));
    expect(byId.get('default')!.reasoningOptions).toEqual([{ id: 'low', label: 'low', default: true }]);
    expect(byId.get('plain')!.reasoningOptions).toEqual([{ id: 'low', label: 'low', default: true }]);
    expect(byId.get('rich')!.reasoningOptions).toEqual([{ id: 'own', label: 'own' }]);
    // 共享常量不被污染
    expect(DEF_DEFAULT.reasoningOptions).toBeUndefined();
  });

  it('resolveEffort：有清单按清单拦，没清单/手填模型/没缓存不拦', async () => {
    const def = fake({
      fetchModels: async () => [{ id: 'rich', label: 'Rich', reasoningOptions: [{ id: 'low', label: 'low' }, { id: 'high', label: 'high' }] }],
    });
    await listAgentModels(def, 'no-such-bin');
    expect(resolveEffort('fake-cli', 'rich', 'high').ok).toBe(true);
    const bad = resolveEffort('fake-cli', 'rich', 'ultra');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('low、high');
    expect(resolveEffort('fake-cli', 'hand-typed', 'ultra').ok).toBe(true);   // 手填模型：放行
    expect(resolveEffort('never-seen', 'rich', 'ultra').ok).toBe(true);       // 没缓存：放行
    expect(resolveEffort('fake-cli', 'rich', '').ok).toBe(true);              // 不传：放行
  });
});
