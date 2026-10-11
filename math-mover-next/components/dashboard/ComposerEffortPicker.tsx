'use client';

/**
 * 推理档位选择（off/low/high/max 之类）。
 *
 * 单独成文件而不塞进 ComposerModelPicker：那组件在被另一条线改着，且档位是
 * **模型的属性**——换个模型档位集就变了，两者生命周期不同，混在一起会互相绊。
 *
 * 用原生 <select>：档位只有几项、无自定义渲染需求，原生的键盘可达与移动端
 * 适配比自绘菜单好。视觉上贴着模型选择器，同一套圆角/字号/配色。
 */
export interface EffortOption {
  id: string;
  label: string;
  default?: boolean;
}

export interface ComposerEffortPickerProps {
  options: EffortOption[];
  selectedId?: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export default function ComposerEffortPicker({ options, selectedId, onSelect, disabled = false }: ComposerEffortPickerProps) {
  // 没得选就不渲染——给一个只有一项的下拉是噪音
  if (options.length <= 1) return null;
  const current = selectedId && options.some((o) => o.id === selectedId)
    ? selectedId
    : (options.find((o) => o.default)?.id ?? options[0]!.id);

  return (
    <label className="flex min-w-0 items-center gap-1">
      <span className="sr-only">推理档位</span>
      <select
        aria-label="推理档位"
        title="推理档位（影响思考深度与速度）"
        value={current}
        disabled={disabled}
        onChange={(e) => onSelect(e.target.value)}
        className="max-w-[5.5rem] cursor-pointer truncate rounded-lg border border-stone-200 bg-transparent px-2 py-1.5 text-xs text-stone-600 transition-colors motion-reduce:transition-none hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
