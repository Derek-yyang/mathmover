'use client';

/**
 * 对话框里的模型选择器（照 assistant-ui 的 ComposerModel 形状：name + meta，轻量）。
 *
 * 放在 composer 工具栏而不是聊天区头部——随手换模型的场景，视线就在输入框。
 * assistant-ui 的分工是：ComposerModel 管「随手换」，ModelPicker（带厂商/上下文/
 * 价格/能力）管「选型对比」。我们是前者，且契约刻意不建模模型能力，所以只做轻的。
 */
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Select } from 'radix-ui';

export interface PickableModel {
  id: string;
  label: string;
  /** 该模型支持的推理档位（如 off/low/high/max）。换模型档位集会变。 */
  reasoningOptions?: Array<{ id: string; label: string; default?: boolean }>;
}

export interface ComposerModelPickerProps {
  models: PickableModel[];
  /** 'live' = 真发现；'fallback' = 兜底别名，菜单说明可用性取决于配置 */
  source?: 'live' | 'fallback';
  selectedId: string;
  onSelect: (id: string) => void;
  /** 发现中：禁用，别让用户在清单没出来前就点 */
  loading?: boolean;
}

/** 来源和映射说明留在菜单里；仅整理显示名，不改模型 ID。 */
function modelPresentation(label: string) {
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

export default function ComposerModelPicker({
  models, source, selectedId, onSelect, loading = false,
}: ComposerModelPickerProps) {
  const current = models.find((m) => m.id === selectedId) ?? models[0];
  const { name } = modelPresentation(current?.label ?? '模型');

  return (
    <Select.Root value={current?.id ?? ''} onValueChange={onSelect} disabled={loading || models.length === 0}>
      <Select.Trigger
        type="button"
        aria-label={`选择模型，当前：${name}`}
        title={name}
        className="group flex min-w-0 max-w-[13rem] items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-stone-600 transition-colors motion-reduce:transition-none hover:bg-stone-100 data-[state=open]:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Select.Value className="truncate">{loading ? '读取中…' : name}</Select.Value>
        <Select.Icon asChild>
          <ChevronDown aria-hidden className="h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none group-data-[state=open]:rotate-180" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper" side="top" align="start" sideOffset={4} collisionPadding={12}
          aria-label="模型列表"
          className="z-30 max-h-[var(--radix-select-content-available-height)] w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-stone-200 bg-white text-stone-700"
        >
          <Select.ScrollUpButton className="flex h-6 items-center justify-center"><ChevronUp aria-hidden className="h-3 w-3" /></Select.ScrollUpButton>
          <Select.Viewport className="py-1">
            <Select.Group>
              {source === 'fallback' && <Select.Label className="px-3 py-1.5 text-[11px] leading-4 text-stone-600">以下为常用模型别名，可用性取决于当前配置。</Select.Label>}
              {models.map(m => {
                const { name: modelName, detail } = modelPresentation(m.label);
                return <Select.Item key={m.id} value={m.id} textValue={modelName}
                  className="relative flex cursor-default select-none items-start gap-2 py-1 pr-3 pl-9 text-xs leading-[18px] outline-none data-[highlighted]:bg-stone-100 data-[state=checked]:text-emerald-800">
                  <Select.ItemIndicator className="absolute top-1.5 left-3"><Check aria-hidden className="h-3.5 w-3.5" /></Select.ItemIndicator>
                  <span className="min-w-0 flex-1">
                    <Select.ItemText className="block break-words">{modelName}</Select.ItemText>
                    {detail && <span className="block break-words text-[11px] leading-[14px] text-stone-600">{detail}</span>}
                  </span>
                  {source === 'fallback' && m.id !== 'default' && <span className="shrink-0 text-xs text-stone-600">别名</span>}
                </Select.Item>;
              })}
            </Select.Group>
          </Select.Viewport>
          <Select.ScrollDownButton className="flex h-6 items-center justify-center"><ChevronDown aria-hidden className="h-3 w-3" /></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
