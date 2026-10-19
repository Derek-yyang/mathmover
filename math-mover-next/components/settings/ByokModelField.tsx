'use client';

import { useId } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { ByokModel } from '@/lib/byok-config';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../assistant-ui/ui/command';
import { cn } from '../assistant-ui/utils';
import { SettingsButton } from './SettingsControls';

export type ModelListState = { loading: boolean; models?: ByokModel[]; error?: string };

export function ByokModelField({ value, onChange, disabled, canFetch, list, onFetch, open, onOpenChange, portalContainer, inputClassName }: {
  value: string; onChange: (value: string) => void; disabled: boolean; canFetch: boolean;
  list: ModelListState; onFetch: () => void; open: boolean; onOpenChange: (open: boolean) => void;
  portalContainer: HTMLDivElement | null; inputClassName: string;
}) {
  const id = useId();
  const models = list.models ?? [];
  return <div className="min-w-0">
    <div className="flex min-h-5 items-center justify-between gap-2">
      <label htmlFor={id} className="text-xs font-medium text-[var(--mm-text-stone-600)]">模型</label>
      <SettingsButton type="button" onClick={onFetch} disabled={disabled || !canFetch || list.loading}
        aria-busy={list.loading} title={!canFetch ? '请先填写 API 端点' : undefined}
        className="h-auto gap-1 px-1 py-0 text-xs leading-5">
        {list.loading && <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin motion-reduce:animate-none" />}
        {list.loading ? '获取中…' : '获取模型列表'}
      </SettingsButton>
    </div>
    <Popover.Root open={open && models.length > 0} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>
        <div className="relative mt-1">
          <input id={id} className={cn(inputClassName, 'mt-0 block', models.length > 0 && 'pr-10')} type="text"
            placeholder="输入模型 ID 或从列表选择" disabled={disabled} value={value} onChange={e => onChange(e.target.value)}
            aria-describedby={list.error || list.models ? `${id}-status` : undefined} />
          {models.length > 0 && <Popover.Trigger asChild>
            <button type="button" aria-label="从列表选择模型" disabled={disabled}
              className="group absolute inset-y-px right-px flex w-8 items-center justify-center rounded-md text-[var(--mm-text-stone-600)] hover:text-[var(--mm-text-stone-900)] data-[state=open]:text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:opacity-50">
              <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform duration-150 motion-reduce:transition-none group-data-[state=open]:rotate-180" />
            </button>
          </Popover.Trigger>}
        </div>
      </Popover.Anchor>
      <Popover.Portal container={portalContainer}>
        <Popover.Content align="start" sideOffset={4} collisionPadding={12}
          collisionBoundary={portalContainer?.closest('[data-slot="settings-dialog"]')}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-56 max-w-[calc(100vw-48px)] overflow-hidden rounded-lg border border-[var(--mm-border-stone-200)] bg-popover text-popover-foreground shadow-md outline-none">
          <Command label="搜索模型" defaultValue={models.some(model => model.id === value) ? value : undefined}>
            <CommandInput aria-label="搜索模型" placeholder="搜索模型名称或 ID…" />
            <CommandList label="模型列表" className="max-h-[min(240px,calc(var(--radix-popover-content-available-height)-48px))] overscroll-contain">
              <CommandEmpty>没有匹配模型，可关闭列表后手动输入。</CommandEmpty>
              <CommandGroup>
                {models.map(model => <CommandItem key={model.id} value={model.id} keywords={[model.label]}
                  onSelect={() => { onChange(model.id); onOpenChange(false); }}>
                  <Check aria-hidden="true" className={`h-4 w-4 shrink-0 ${model.id === value ? 'text-primary' : 'opacity-0'}`} />
                  <span className="min-w-0 break-all">
                    <span className="block">{model.label}</span>
                    {model.label !== model.id && <span className="block text-xs text-muted-foreground">{model.id}</span>}
                  </span>
                </CommandItem>)}
              </CommandGroup>
            </CommandList>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    <p id={`${id}-status`} role={list.error ? 'alert' : 'status'}
      className={`mt-1 text-xs leading-5 ${list.error ? 'text-[var(--mm-text-amber-900)]' : 'text-[var(--mm-text-stone-600)]'}`}>
      {list.error ?? (list.models ? models.length ? `已获取 ${models.length} 个模型` : '未返回模型，可手动输入模型 ID。' : '')}
    </p>
  </div>;
}
