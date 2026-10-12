'use client';

/**
 * 对话框工具栏的「模型 + 推理档位」组合面板。
 *
 * 形制对齐 claude TUI 的 Select Model and Effort：上半是两行式模型清单
 * （名字 + 来源/映射说明），底部横条是点阵档位。合体的理由：档位本来就是
 * **模型的属性**（reasoningOptions 挂在模型上，换模型档位集就变），分离的
 * 小控件体现不了从属关系；合体后档位行随选中的模型原地换档位集。
 *
 * 交互约定：选模型**不关**面板（接着就地套档位，还能看到档位行跟着换）；
 * 选完档位即关（它是这一步的收尾）；Esc / 点外面 / 再点触发钮也能关。
 *
 * 价格/上下文长度/能力信息刻意不建模（那是「选型对比」的事，见 agent-runtime
 * defs.ts 的裁决），说明行放的是来源与映射。
 *
 * 放 composer 工具栏而不是聊天区头部——随手换的场景，视线就在输入框。
 */
import { useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover } from 'radix-ui';
import { effortDisplay, modelPresentation, type EffortOption } from '@/lib/agent-picker';

export type { EffortOption };

export interface PickableModel {
  id: string;
  label: string;
  /** 该模型支持的推理档位（如 off/low/high/max）。换模型档位集会变。 */
  reasoningOptions?: EffortOption[];
}

export interface ComposerModelPickerProps {
  models: PickableModel[];
  /** 'live' = 真发现；'fallback' = 兜底别名，菜单说明可用性取决于配置 */
  source?: 'live' | 'fallback';
  selectedId: string;
  onSelect: (id: string) => void;
  /** 发现中：禁用，别让用户在清单没出来前就点 */
  loading?: boolean;
  /** 当前模型的档位清单（宿主已合并运行时级档位）；空 = 该模型用 Agent 配置 */
  reasoningOptions?: EffortOption[];
  selectedEffort?: string;
  onSelectEffort?: (id: string) => void;
}

export default function ComposerModelPicker({
  models, source, selectedId, onSelect, loading = false,
  reasoningOptions, selectedEffort, onSelectEffort,
}: ComposerModelPickerProps) {
  const [open, setOpen] = useState(false);
  const current = models.find((m) => m.id === selectedId) ?? models[0];
  const currentName = modelPresentation(current?.label ?? '模型').name;
  const effort = effortDisplay(reasoningOptions, selectedEffort);

  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const dotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusRow = (index: number) => rowRefs.current[index]?.focus();

  // 打开面板：焦点落到当前选中（或第一行）的模型行
  const selectedRow = Math.max(0, models.findIndex((m) => m.id === current?.id));
  const focusSelectedRow = () => requestAnimationFrame(() => focusRow(selectedRow));

  const pickModel = (id: string) => {
    onSelect(id);
    // 不关面板：档位行随新模型换档位集，接着就能套
  };
  const pickEffort = (id: string) => {
    onSelectEffort?.(id);
    setOpen(false);   // 档位是这一步的收尾
  };

  const onRowKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = models.length - 1;
    const go = (next: number) => { event.preventDefault(); focusRow(next); };
    if (event.key === 'ArrowDown') go(index === last ? 0 : index + 1);
    else if (event.key === 'ArrowUp') go(index === 0 ? last : index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(last);
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickModel(models[index]!.id);
    }
  };

  const onDotKeyDown = (event: React.KeyboardEvent, index: number) => {
    const options = reasoningOptions!;
    const last = options.length - 1;
    // 手动选择式（toolbar/radiogroup 变体）：方向键只移动焦点浏览档位，
    // Enter/Space 才选定并关闭——方向键一动就关面板，键盘用户没法浏览档位。
    const go = (next: number) => {
      event.preventDefault();
      requestAnimationFrame(() => dotRefs.current[next]?.focus());
    };
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') go(index === last ? last : index + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') go(index === 0 ? 0 : index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(last);
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickEffort(options[index]!.id);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) focusSelectedRow(); }}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`选择模型与推理档位，当前：${currentName}${effort ? `，${effort.option.label}` : ''}`}
          title={effort ? `${currentName} · ${effort.option.label}${effort.pinned ? '' : '（默认）'}` : currentName}
          disabled={loading || models.length === 0}
          className="group flex min-w-0 max-w-[13rem] items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-stone-600 transition-colors motion-reduce:transition-none hover:bg-stone-100 data-[state=open]:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="truncate">{loading ? '读取中…' : currentName}</span>
          {effort && <span className="shrink-0 text-stone-500">· {effort.option.id}</span>}
          <ChevronDown aria-hidden className="h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none group-data-[state=open]:rotate-180" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top" align="start" sideOffset={4} collisionPadding={12}
          onOpenAutoFocus={(event) => { event.preventDefault(); focusSelectedRow(); }}
          className="z-30 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-stone-200 bg-white text-stone-700"
        >
          <div role="listbox" aria-label="模型列表" className="max-h-56 overflow-y-auto overscroll-contain py-1">
            {source === 'fallback' && (
              <p className="px-3 py-1.5 text-[11px] leading-4 text-stone-600">以下为常用模型别名，可用性取决于当前配置。</p>
            )}
            {models.map((m, index) => {
              const { name, detail } = modelPresentation(m.label);
              const checked = m.id === current?.id;
              return (
                <button
                  key={m.id}
                  ref={(el) => { rowRefs.current[index] = el; }}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  tabIndex={checked ? 0 : -1}
                  onClick={() => pickModel(m.id)}
                  onKeyDown={(event) => onRowKeyDown(event, index)}
                  className="relative flex w-full cursor-default select-none items-start gap-2 py-1 pr-3 pl-9 text-left text-xs leading-[18px] outline-none hover:bg-stone-100 focus-visible:bg-stone-100"
                >
                  {checked && <Check aria-hidden className="absolute top-1.5 left-3 h-3.5 w-3.5 text-emerald-800" />}
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">{name}</span>
                    {detail && <span className="block break-words text-[11px] leading-[14px] text-stone-600">{detail}</span>}
                  </span>
                  {source === 'fallback' && m.id !== 'default' && <span className="shrink-0 text-xs text-stone-600">别名</span>}
                </button>
              );
            })}
          </div>
          <div className="border-t border-stone-200 px-3 py-2.5">
            {effort ? (
              <div className="flex items-center gap-2.5">
                <span id="composer-effort-label" className="shrink-0 text-xs text-stone-600">
                  推理档位{effort.pinned ? '' : '（默认）'}
                </span>
                {/* 点阵是序数：越靠右思考越深。当前档用大圆点（knob），其余小点。
                    档位名不标在点上（点放不下且档位集各家不同），右端复述当前值。 */}
                <div
                  role="radiogroup"
                  aria-labelledby="composer-effort-label"
                  className="relative flex min-w-0 flex-1 items-center justify-between"
                >
                  <span aria-hidden className="pointer-events-none absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-stone-200" />
                  {reasoningOptions!.map((o, index) => {
                    const active = o.id === effort.option.id;
                    return (
                      <button
                        key={o.id}
                        ref={(el) => { dotRefs.current[index] = el; }}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={o.label}
                        tabIndex={active ? 0 : -1}
                        onClick={() => pickEffort(o.id)}
                        onKeyDown={(event) => onDotKeyDown(event, index)}
                        className={`relative rounded-full transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-emerald-700 ${active ? 'h-3.5 w-3.5 bg-emerald-700' : 'h-2 w-2 bg-stone-300 hover:bg-stone-400'}`}
                      />
                    );
                  })}
                </div>
                <span className="shrink-0 text-xs text-stone-700">（{effort.option.label}）</span>
              </div>
            ) : (
              <p className="text-xs leading-5 text-stone-500">推理档位：由 Agent 配置决定</p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
