'use client';

/**
 * 对话框里的模型选择器（照 assistant-ui 的 ComposerModel 形状：name + meta，轻量）。
 *
 * 放在 composer 工具栏而不是聊天区头部——随手换模型的场景，视线就在输入框。
 * assistant-ui 的分工是：ComposerModel 管「随手换」，ModelPicker（带厂商/上下文/
 * 价格/能力）管「选型对比」。我们是前者，且契约刻意不建模模型能力，所以只做轻的。
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface PickableModel {
  id: string;
  label: string;
}

export interface ComposerModelPickerProps {
  models: PickableModel[];
  /** 'live' = 真发现；'fallback' = 兜底提示，选项会标「·提示」 */
  source?: 'live' | 'fallback';
  selectedId: string;
  onSelect: (id: string) => void;
  /** 发现中：禁用，别让用户在清单没出来前就点 */
  loading?: boolean;
}

/** 清单太长时只显示 name 部分；label 里的映射说明放第二行。 */
function shortLabel(label: string): string {
  return label.split('→')[0]?.trim() || label;
}

/** 映射说明（`→` 之后的部分）；没有映射则为空，只显示一行。 */
function mappingDetail(label: string): string {
  const i = label.indexOf('→');
  return i < 0 ? '' : label.slice(i + 1).trim();
}

export default function ComposerModelPicker({
  models, source, selectedId, onSelect, loading = false,
}: ComposerModelPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 外点关闭 + Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 只有「默认」一项且不能手填 = 该 agent 没得选，整个控件不渲染（由调用方判）
  const current = models.find((m) => m.id === selectedId) ?? models[0];
  const title = current ? current.label : '模型';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择模型"
        title={title}
        disabled={loading || models.length === 0}
        onClick={() => setOpen((v) => !v)}
        className={`flex max-w-[13rem] items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-stone-600 transition-colors motion-reduce:transition-none hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 ${open ? 'bg-stone-100' : ''}`}
      >
        <span className="truncate">{loading ? '读取中…' : shortLabel(current?.label ?? '模型')}</span>
        <ChevronDown aria-hidden className={`h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="模型列表"
          className="absolute bottom-full left-0 z-30 mb-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
        >
          {source === 'fallback' && (
            <li className="px-3 py-1.5 text-[11px] leading-4 text-stone-500">
              以下是常见别名，未在本机验证；选错了跑不起来请换回「默认」。
            </li>
          )}
          {models.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={m.id === selectedId}
                onClick={() => { onSelect(m.id); setOpen(false); }}
                className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs leading-5 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-emerald-700 ${m.id === selectedId ? 'text-emerald-800' : 'text-stone-700'}`}
              >
                <Check aria-hidden className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${m.id === selectedId ? 'opacity-100' : 'opacity-0'}`} />
                <span className="min-w-0">
                  <span className="block truncate">{shortLabel(m.label)}</span>
                  {mappingDetail(m.label) && (
                    <span className="block truncate text-[11px] text-stone-500">{mappingDetail(m.label)}</span>
                  )}
                </span>
                {source === 'fallback' && m.id !== 'default' && (
                  <span className="ml-auto shrink-0 text-[11px] text-stone-400">提示</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
