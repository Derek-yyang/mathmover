/**
 * 从 agent 的工具调用里抽出运行元数据，写进消息 meta。
 *
 * 为什么从 tool-call 的 `input` 取：AgentEvent 的 tool-call 事件带 `input`（工具入参），
 * 而 AgentToolStep 只记 name/status/endedAt，不记入参。标题与类别都是**入参**，
 * 所以只能从事件流取。
 */
import type { AgentMeta } from '@/components/dashboard/types';

/**
 * 类别显示名。只服务运行结果面板的展示（「本轮是 B 类平面几何题」）。
 * 与课件标题无关——标题不绑分类，产品定位不止题图→GGB 一条链路。
 */
export const CATEGORY_LABEL: Record<string, string> = {
  A: '函数与图像',
  B: '平面几何',
  C: '解析几何',
  D: '立体几何',
};

const TOOL_SUFFIX = /^(?:mcp__[^_]+__)?([a-z_]+)$/;

/** 工具名归一：`mcp__mathmover__submit_construction` → `submit_construction`。 */
export function toolBaseName(name: unknown): string {
  const raw = typeof name === 'string' ? name : '';
  return raw.startsWith('mcp__') ? raw.slice(raw.lastIndexOf('__') + 2) : raw;
}

/**
 * 抽出这次工具调用带来的元数据。只认两个入口：
 * - `get_expert_prompt` 的 `category`（题目增强判类）
 * - `submit_construction` 的 `category` / `title`（收卷时的类别与命名）
 * `submit_construction` 不给 category（纯画图/改图），那就不写。
 */
export function metaFromToolCall(name: unknown, input: unknown): Partial<AgentMeta> {
  const base = toolBaseName(name);
  if (base !== 'submit_construction' && base !== 'get_expert_prompt') return {};
  const args = (input ?? {}) as { title?: unknown; category?: unknown };
  const out: Partial<AgentMeta> = {};
  if (typeof args.category === 'string' && /^[ABCD]$/.test(args.category)) {
    out.category = args.category;
    out.categoryLabel = CATEGORY_LABEL[args.category];
  }
  if (typeof args.title === 'string') {
    const t = args.title.trim().slice(0, 60);
    if (t) out.title = t;
  }
  return out;
}

/** 合进消息 meta：后来的同类字段覆盖先前的，空值不动。 */
export function mergeRunMeta(meta: AgentMeta | undefined, patch: Partial<AgentMeta>): AgentMeta | undefined {
  const keys = Object.keys(patch) as Array<keyof AgentMeta>;
  if (!keys.length) return meta;
  return { ...(meta ?? {}), ...Object.fromEntries(keys.map((k) => [k, patch[k]])) } as AgentMeta;
}
