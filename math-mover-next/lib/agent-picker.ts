/**
 * 「模型 + 推理档位」组合面板的纯逻辑（展示名整理 + 档位取值语义）。
 * 纯函数放 lib 是为了可测；组件只管交互与布局。
 */

export interface EffortOption {
  id: string;
  label: string;
  /** 默认档（= agent 自己配置里生效的那个） */
  default?: boolean;
}

/**
 * 来源和映射说明留给面板第二行；仅整理显示名，不改模型 ID。
 * label 形如 `Opus → claude-opus-5[1M]（claude-haiku-5-5）` 或 `gpt-6.1-sol（config.toml）`。
 */
export function modelPresentation(label: string): { name: string; detail: string } {
  const [head, ...mapping] = label.split('→');
  const suffix = head.trim().match(/\s*[（(]([^（）()]+)[）)]\s*$/);
  const name = (suffix ? head.trim().slice(0, suffix.index) : head).trim();
  const source = suffix?.[1];
  const detail = [
    source === 'config.toml' ? '来自 config.toml' : source === '用 CLI 自己的配置' ? '使用 Agent 的默认配置' : source,
    mapping.join('→').trim(),
  ].filter(Boolean).join(' · ');
  return { name: name || label, detail };
}

/**
 * 档位的「当前值」语义：
 * - 显式选过且在清单里 → 用它（pinned: true）
 * - 没选过（或选过的值已失效）→ 用 default 标记，即 agent 自己配置里生效的档位
 *   （pinned: false，显示「默认」，不下发——让 agent 用自己的配置）
 * - 没有 default 标记 → 第一项兜底（只是展示，不改变不下发的语义）
 * 返回 null = 该模型没有档位清单（整个用 Agent 配置，面板显示说明行）。
 */
export function effortDisplay(
  options: EffortOption[] | undefined,
  selectedId: string | undefined,
): { option: EffortOption; pinned: boolean } | null {
  if (!options?.length) return null;
  const pinned = selectedId ? options.find((o) => o.id === selectedId) : undefined;
  if (pinned) return { option: pinned, pinned: true };
  const fallback = options.find((o) => o.default) ?? options[0]!;
  return { option: fallback, pinned: false };
}
