'use client';

import { useId, useRef, type KeyboardEvent } from 'react';
import { Settings2, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { EffortOption } from '@/lib/agent-picker';

/** Settings uses named segments; the composer keeps its compact effort dots. */
export function ReasoningEffortSelector({ options, currentId, pinned, onSelect, disabled, configDisabled, vocabulary, onToggle, portalContainer }: {
  options: EffortOption[];
  currentId: string;
  pinned: boolean;
  onSelect: (id: string) => void;
  disabled: boolean;
  configDisabled: boolean;
  vocabulary: readonly string[];
  onToggle: (id: string) => void;
  portalContainer: HTMLDivElement | null;
}) {
  const id = useId();
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + options.length - 1) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    onSelect(options[next].id);
    items.current[next]?.focus();
  };
  return <div data-effort-preview className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
    <span id={`${id}-label`} className="shrink-0 text-xs font-medium text-[var(--mm-text-stone-600)]"
      title={pinned ? undefined : '当前使用 Agent 的默认档位'}>
      思考档位{!pinned && <span className="sr-only">（默认）</span>}
    </span>
    <div role="radiogroup" aria-disabled={disabled} aria-labelledby={`${id}-label`}
      className="flex min-w-0 flex-1 flex-wrap gap-0.5 rounded-lg bg-[var(--mm-bg-stone-100)] p-1">
      {options.map((option, index) => <button key={option.id} type="button" role="radio" aria-label={option.label}
        ref={element => { items.current[index] = element; }}
        aria-checked={option.id === currentId} tabIndex={option.id === currentId ? 0 : -1} disabled={disabled}
        onClick={() => onSelect(option.id)} onKeyDown={event => handleKeyDown(event, index)}
        className="min-h-8 min-w-14 flex-1 rounded-md px-2.5 py-1 text-xs leading-5 text-[var(--mm-text-stone-600)] transition-colors hover:bg-[var(--mm-bg-stone-200)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)] aria-checked:bg-[var(--mm-bg-emerald-100)] aria-checked:font-semibold aria-checked:text-[var(--mm-text-emerald-800)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none">
        {option.label}
      </button>)}
    </div>
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" aria-label="配置可用档位" title="配置可用档位" disabled={configDisabled}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--mm-text-stone-600)] transition-colors hover:bg-[var(--mm-bg-stone-100)] hover:text-[var(--mm-text-stone-900)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)] data-[state=open]:bg-[var(--mm-bg-stone-100)] data-[state=open]:text-[var(--mm-text-stone-900)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none">
          <Settings2 aria-hidden className="h-4 w-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={portalContainer}>
        <Popover.Content align="end" sideOffset={6} collisionPadding={12}
          collisionBoundary={portalContainer?.closest('[data-slot="settings-dialog"]')}
          aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
          className="z-50 w-72 max-w-[calc(100vw-48px)] rounded-xl border border-[var(--mm-border-stone-300)] bg-popover p-3 text-popover-foreground outline-none">
          <div className="flex items-center justify-between gap-2">
            <h4 id={`${id}-title`} className="text-sm font-semibold">可用档位</h4>
            <Popover.Close asChild>
              <button type="button" aria-label="关闭档位配置"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--mm-text-stone-600)] hover:bg-[var(--mm-bg-stone-100)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]">
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            </Popover.Close>
          </div>
          <p id={`${id}-description`} className="mt-1 text-xs leading-5 text-[var(--mm-text-stone-600)]">勾选要显示的档位，修改后保存配置。</p>
          <fieldset className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
            <legend className="sr-only">可用档位</legend>
            {vocabulary.map(value => <label key={value}
              className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-[var(--mm-text-stone-800)] hover:bg-[var(--mm-bg-stone-100)] has-disabled:cursor-not-allowed has-disabled:opacity-50">
              <input type="checkbox" checked={options.some(option => option.id === value)}
                aria-label={`档位 ${value}`} disabled={configDisabled} onChange={() => onToggle(value)}
                className="h-3.5 w-3.5 shrink-0 accent-[var(--mm-bg-emerald-700)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)]" />
              {value}
            </label>)}
          </fieldset>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>;
}
