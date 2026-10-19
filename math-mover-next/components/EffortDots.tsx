'use client';

/**
 * 推理档位点阵 —— 合成器面板与设置页**共用同一份**渲染。
 *
 * 抽出来是为了让设置页能「实时预览」：用户在设置里勾了哪几个档位，聊天区的
 * 模型面板里就会长成什么样。两份各写一遍必然漂移，而漂移在这里的代价是
 * 用户按预览做的判断是错的。
 *
 * 交互是可选的：`onSelect` 不传就是纯展示（预览不该是可聚焦的控件，也不该
 * 进无障碍树被读成一组单选）；传了才渲染成 radiogroup + 悬停提示 + 键盘导航
 * （键盘与 ref 由调用方给，因为「只有档位可选时把焦点放到当前档位」这件事
 * 只有调用方知道）。
 */

import type { KeyboardEvent, RefObject } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/assistant-ui/ui/tooltip';
import type { EffortOption } from '@/lib/agent-picker';

export default function EffortDots({
  options, currentId, pinned, onSelect, onDotKeyDown, dotRefs, labelId,
}: {
  options: EffortOption[];
  /** 当前档位（`effortDisplay` 定的那个） */
  currentId: string;
  /** 当前档位是不是用户显式选的（否则是 Agent 配置里的默认） */
  pinned?: boolean;
  onSelect?: (id: string) => void;
  onDotKeyDown?: (event: KeyboardEvent, index: number) => void;
  dotRefs?: RefObject<Array<HTMLButtonElement | null>>;
  labelId: string;
}) {
  const interactive = typeof onSelect === 'function';
  const strip = (
    <div role={interactive ? 'radiogroup' : undefined} aria-labelledby={interactive ? labelId : undefined}
      aria-hidden={interactive ? undefined : true}
      className="relative flex h-4 min-w-0 flex-1 items-center">
      {options.map((option, index) => {
        const active = option.id === currentId;
        const mark = (
          <>
            <span aria-hidden className={`pointer-events-none absolute top-1/2 h-px -translate-y-1/2 bg-[var(--mm-bg-stone-200)] ${index === 0 ? 'left-1/2' : 'left-0'} ${index === options.length - 1 ? 'right-1/2' : 'right-0'}`} />
            <span aria-hidden className={`pointer-events-none relative shrink-0 rounded-full transition-colors motion-reduce:transition-none ${active ? 'h-3.5 w-3.5 bg-[var(--mm-bg-emerald-700)]' : 'h-2 w-2 bg-[var(--mm-bg-stone-300)] group-hover:bg-[var(--mm-bg-stone-400)]'}`} />
          </>
        );
        const shell = 'group relative flex h-7 min-w-0 flex-1 items-center justify-center rounded-md';
        if (!interactive) return <span key={option.id} className={shell}>{mark}</span>;
        return (
          <Tooltip key={option.id}>
            <TooltipTrigger asChild>
              <button
                ref={(el) => { if (dotRefs) dotRefs.current[index] = el; }}
                type="button" role="radio" aria-checked={active} aria-label={option.label}
                tabIndex={active ? 0 : -1}
                onClick={() => onSelect!(option.id)}
                onKeyDown={(event) => onDotKeyDown?.(event, index)}
                className={`${shell} cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]`}>
                {mark}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} collisionPadding={12} className="pointer-events-none px-2 py-1 motion-reduce:animate-none">
              {option.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );

  return (
    <div className="flex items-center gap-2.5">
      <span id={labelId} className="shrink-0 whitespace-nowrap text-xs text-[var(--mm-text-stone-600)]"
        title={pinned ? undefined : '当前使用 Agent 的默认档位'}>
        推理档位{!pinned && <span className="sr-only">（默认）</span>}
      </span>
      {/* 小圆点保持原有外观，每个档位的整格都可点；较高的按钮借用已有纵向留白。
          悬停与键盘聚焦时提示名称，右端仍显示当前档位。 */}
      {interactive
        ? <TooltipProvider delayDuration={250} skipDelayDuration={100} disableHoverableContent>{strip}</TooltipProvider>
        : strip}
      <span className="grid shrink-0 whitespace-nowrap text-xs text-[var(--mm-text-stone-700)]">
        {/* Overlapping hidden labels reserve the actual widest option without measuring the DOM. */}
        {options.map(option => <span key={option.id} aria-hidden="true"
          className="invisible col-start-1 row-start-1">（{option.label}）</span>)}
        <span className="col-start-1 row-start-1 text-right">（{options.find(o => o.id === currentId)?.label ?? currentId}）</span>
      </span>
    </div>
  );
}
