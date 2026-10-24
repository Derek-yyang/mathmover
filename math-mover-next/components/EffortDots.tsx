'use client';

/**
 * 对话输入区使用的紧凑推理档位点阵。
 *
 * 设置页改用 ReasoningEffortSelector 分段选择器；两处通过 AgentRuntimeState
 * 共享可用档位与当前选择，展示形式各自适配使用场景。
 *
 * 交互是可选的：`onSelect` 不传就是纯展示（预览不该是可聚焦的控件，也不该
 * 进无障碍树被读成一组单选）；传了才渲染成 radiogroup + 键盘导航。
 * 支持常驻名称；合成器的紧凑点阵使用悬停提示。
 * 默认方向键直接选择；合成器可传入自己的键盘策略和 ref，保留面板焦点行为。
 */

import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/assistant-ui/ui/tooltip';
import type { EffortOption } from '@/lib/agent-picker';

export default function EffortDots({
  options, currentId, pinned, onSelect, onDotKeyDown, dotRefs, labelId, label = '推理档位', disabled = false, showOptionLabels = false, labelAction,
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
  label?: string;
  disabled?: boolean;
  /** Settings shows persistent option names; the composer keeps its compact strip. */
  showOptionLabels?: boolean;
  /** Optional Settings action aligned with the label, above the option strip. */
  labelAction?: ReactNode;
}) {
  const interactive = typeof onSelect === 'function';
  const localDotRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const refs = dotRefs ?? localDotRefs;
  const handleKeyDown = (event: KeyboardEvent, index: number) => {
    if (onDotKeyDown) { onDotKeyDown(event, index); return; }
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + options.length - 1) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    onSelect?.(options[next].id);
    refs.current[next]?.focus();
  };
  const strip = (
    <div role={interactive ? 'radiogroup' : undefined} aria-labelledby={interactive ? labelId : undefined}
      aria-disabled={interactive ? disabled : undefined}
      aria-hidden={interactive ? undefined : true}
      className={showOptionLabels ? 'relative flex min-w-0 items-center overflow-x-auto px-1' : 'relative flex h-4 min-w-0 flex-1 items-center'}>
      {options.map((option, index) => {
        const active = option.id === currentId;
        const mark = (
          <>
            <span aria-hidden className={`pointer-events-none absolute top-1/2 h-px -translate-y-1/2 bg-[var(--mm-bg-stone-200)] ${index === 0 ? 'left-1/2' : 'left-0'} ${index === options.length - 1 ? 'right-1/2' : 'right-0'}`} />
            <span aria-hidden className={`pointer-events-none relative shrink-0 rounded-full transition-colors motion-reduce:transition-none ${active ? 'h-3.5 w-3.5 bg-[var(--mm-bg-emerald-700)]' : 'h-2 w-2 bg-[var(--mm-bg-stone-300)] group-hover:bg-[var(--mm-bg-stone-400)]'}`} />
          </>
        );
        const shell = showOptionLabels
          ? 'group relative flex min-h-11 min-w-14 flex-1 flex-col items-center justify-center rounded-md py-1'
          : 'group relative flex h-8 min-w-0 flex-1 items-center justify-center rounded-md';
        const contents = showOptionLabels ? <>
          <span className="relative flex h-4 w-full items-center justify-center">{mark}</span>
          <span aria-hidden className={`whitespace-nowrap text-xs leading-4 ${active ? 'font-semibold text-[var(--mm-text-emerald-800)]' : 'text-[var(--mm-text-stone-600)]'}`}>{option.label}</span>
        </> : mark;
        if (!interactive) return <span key={option.id} className={shell}>{contents}</span>;
        const button = <button key={option.id}
          ref={(el) => { refs.current[index] = el; }}
          type="button" role="radio" aria-checked={active} aria-label={option.label}
          disabled={disabled}
          tabIndex={active ? 0 : -1}
          onClick={() => onSelect!(option.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          className={`${shell} cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)] ${showOptionLabels ? 'focus-visible:outline-offset-[-2px]' : ''} disabled:cursor-not-allowed disabled:opacity-50`}>
          {contents}
        </button>;
        // Persistent labels need no hover overlay (which could cover nearby settings).
        if (showOptionLabels) return button;
        return (
          <Tooltip key={option.id}>
            <TooltipTrigger asChild>
              {button}
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} collisionPadding={12} className="pointer-events-none px-2 py-1 motion-reduce:animate-none">
              {option.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );

  const heading = <span id={labelId} className="shrink-0 whitespace-nowrap text-xs text-[var(--mm-text-stone-600)]"
        title={pinned ? undefined : '当前使用 Agent 的默认档位'}>
        {label}{!pinned && <span className="sr-only">（默认）</span>}
      </span>;
  return (
    <div className={showOptionLabels ? 'flex min-w-0 flex-col' : 'flex items-center gap-2.5'}>
      {showOptionLabels
        ? <div className="flex min-h-6 items-center justify-between gap-2">{heading}{labelAction}</div>
        : heading}
      {/* Each full cell is clickable; labels stay visible in Settings and compact elsewhere. */}
      {interactive && !showOptionLabels
        ? <TooltipProvider delayDuration={250} skipDelayDuration={100} disableHoverableContent>{strip}</TooltipProvider>
        : strip}
      {!showOptionLabels && <span className="grid shrink-0 whitespace-nowrap text-xs text-[var(--mm-text-stone-700)]">
        {/* Overlapping hidden labels reserve the actual widest option without measuring the DOM. */}
        {options.map(option => <span key={option.id} aria-hidden="true"
          className="invisible col-start-1 row-start-1">（{option.label}）</span>)}
        <span className="col-start-1 row-start-1 text-right">（{options.find(o => o.id === currentId)?.label ?? currentId}）</span>
      </span>}
    </div>
  );
}
