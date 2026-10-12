/**
 * 模型发现与校验（对齐 OpenDesign 的 apps/daemon/src/runtimes/models.ts）。
 *
 * 三层来源，取第一个成功的：
 *   1. `listModels`   —— CLI 自带 `models` 子命令
 *   2. `fetchModels`  —— 自定义发现（读配置、探代理路由）
 *   3. `fallbackModels` —— 兜底提示清单
 *
 * **`fallbackModels` 不是真清单**。它只是 UI 上的提示，让用户知道有这些别名可试。
 * 下发前必须对 live 清单校验（`resolveModel`），否则会出现「UI 显示了一个模型，
 * 实际跑不了」——OpenDesign 的注释原话：don't trust any value present in the
 * static fallback。
 */
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_MODEL_OPTION,
  type RuntimeDefinition,
  type RuntimeModelOption,
  type RuntimeModelSource,
  type RuntimeReasoningOption,
} from './defs.ts';

export { DEFAULT_MODEL_OPTION };

export interface ModelListing {
  models: RuntimeModelOption[];
  /** 'live' = 真发现；'fallback' = 只有兜底提示，不可当真清单用 */
  source: RuntimeModelSource;
  /** 发现失败时的原因，便于诊断（source='fallback' 时才有） */
  reason?: string;
}

/**
 * 最近一次呈现给 UI 的 live 清单，按运行时 id 缓存。
 * 校验用户选择时用它——而不是用 fallback。
 */
const liveModels = new Map<string, Map<string, RuntimeModelOption>>();

export function rememberLiveModels(agentId: string, models: RuntimeModelOption[]): void {
  const ok = models.filter((m): m is RuntimeModelOption => !!m && typeof m.id === 'string');
  if (ok.length) liveModels.set(agentId, new Map(ok.map((m) => [m.id, m])));
}

export function liveModelIds(agentId: string): string[] {
  return [...(liveModels.get(agentId)?.keys() ?? [])];
}

/**
 * 校验用户选的模型 id。
 *
 * - `'default'` 恒放行（= 不传 --model）
 * - 有 live 缓存时：必须在 live 清单里，否则拒绝
 * - 无 live 缓存时：放行（我们无从判断，别替用户判死）——但调用方应先跑一次发现
 */
export function resolveModel(
  agentId: string,
  modelId: string | null | undefined,
  opts: { supportsCustomModel?: boolean } = {},
): { ok: true; model?: string } | { ok: false; reason: string } {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (!id || id === DEFAULT_MODEL_OPTION.id) return { ok: true };
  const known = liveModels.get(agentId);
  if (!known) return { ok: true, model: id };           // 没清单可对，别瞎拦
  if (known.has(id)) return { ok: true, model: id };
  if (opts.supportsCustomModel) return { ok: true, model: id };   // 允许手填
  return {
    ok: false,
    reason: `模型「${id}」不在本机该 Agent 的可用清单里（共 ${known.size} 个）。`
      + `可选：${[...known.keys()].slice(0, 8).join('、')}`,
  };
}

/**
 * 校验推理档位。档位清单**取自 agent 自己的配置**（见 RuntimeReasoningOption）：
 * - 无 live 缓存 / 该模型没档位清单：不过问（别替用户判死）
 * - 手填的模型不在清单里：放行（同 resolveModel 对手填的态度）
 * - 有清单但档位不在其中：拒绝——UI 显示了一个跑不了的档位是 bug
 */
export function resolveEffort(
  agentId: string,
  modelId: string | null | undefined,
  effort: string | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  const id = typeof effort === 'string' ? effort.trim() : '';
  if (!id) return { ok: true };
  const known = liveModels.get(agentId);
  if (!known) return { ok: true };
  const model = known.get((typeof modelId === 'string' && modelId.trim()) || DEFAULT_MODEL_OPTION.id);
  const options = model?.reasoningOptions;
  if (!options?.length) return { ok: true };
  return options.some((o) => o.id === id)
    ? { ok: true }
    : { ok: false, reason: `推理档位「${id}」不在该模型的档位清单里：${options.map((o) => o.id).join('、')}` };
}

/** 跑 `listModels.args` 并解析。失败返回 null（不是抛错——失败要能降级到下一层）。 */
function runListModels(
  def: RuntimeDefinition,
  spawn: { command: string; prefixArgs?: string[] },
  env: NodeJS.ProcessEnv,
): { models: RuntimeModelOption[] } | { error: string } {
  const spec = def.listModels!;
  const r = spawnSync(spawn.command, [...(spawn.prefixArgs ?? []), ...spec.args], {
    encoding: 'utf-8',
    timeout: spec.timeoutMs ?? 8000,
    env,
    windowsHide: true,
  });
  if (r.status !== 0) return { error: `exit ${r.status}${r.error ? ` (${r.error.message})` : ''}` };
  try {
    const parsed = spec.parse(r.stdout ?? '');
    return parsed && parsed.length ? { models: parsed } : { error: '解析结果为空' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * spawn 目标。npm 的 .cmd shim 解析后 command 是 node、脚本在 prefixArgs 里——
 * 只传 command 会 spawn 空 node（resolve.ts 里踩过的坑）。
 */
type SpawnLike = string | { command: string; prefixArgs?: string[] };

const asSpawn = (s: SpawnLike): { command: string; prefixArgs?: string[] } =>
  typeof s === 'string' ? { command: s } : s;

/**
 * 取该运行时的模型清单。**不抛错**——探测失败要能降级，不能让整个 run 挂掉。
 *
 * @param spawn 解析后的真实入口（resolveSpawnTarget 的结果；传字符串则无 prefixArgs）
 */
export async function listAgentModels(
  def: RuntimeDefinition,
  spawn: SpawnLike,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ModelListing> {
  const target = asSpawn(spawn);
  // 运行时级档位（claude --effort 这类与模型无关的会话旗标）：发现一次，
  // 下面合并进没自带档位的行。模型自带的（codex 目录 / dsh --models）以模型为准。
  let runtimeReasoning: RuntimeReasoningOption[] | null = null;
  if (def.fetchReasoningOptions) {
    try {
      runtimeReasoning = await def.fetchReasoningOptions(target, env);
    } catch { /* 探不出档位就不出档位选择，不影响模型清单 */ }
  }
  const withDefault = (models: RuntimeModelOption[], source: RuntimeModelSource, reason?: string): ModelListing => {
    const seen = new Set<string>();
    const merged: RuntimeModelOption[] = [];
    for (const m of [DEFAULT_MODEL_OPTION, ...models]) {
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      // DEFAULT_MODEL_OPTION 是共享常量——合并档位时克隆，绝不改原对象
      merged.push(m.reasoningOptions?.length || !runtimeReasoning?.length
        ? m
        : { ...m, reasoningOptions: runtimeReasoning });
    }
    if (source === 'live') rememberLiveModels(def.id, merged);
    return { models: merged, source, reason };
  };

  // 1) CLI 自带的 models 子命令
  if (def.listModels) {
    const r = runListModels(def, target, env);
    if ('models' in r) return withDefault(r.models, 'live');
    // 2) 自定义发现
    if (def.fetchModels) {
      try {
        const models = await def.fetchModels(target, env);
        if (models?.length) return withDefault(models, 'live', `listModels 失败：${r.error}`);
      } catch { /* 继续降级 */ }
    }
    return withDefault(def.fallbackModels ?? [], 'fallback', `listModels 失败：${r.error}`);
  }

  // 2) 自定义发现
  if (def.fetchModels) {
    try {
      const models = await def.fetchModels(target, env);
      if (models?.length) return withDefault(models, 'live');
    } catch (e) {
      return withDefault(def.fallbackModels ?? [], 'fallback', e instanceof Error ? e.message : String(e));
    }
  }

  // 3) 兜底
  return withDefault(def.fallbackModels ?? [], 'fallback', '该运行时无模型发现能力');
}
