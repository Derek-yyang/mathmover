'use client';

import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Eye, EyeOff, KeyRound, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  ONLINE_API_FORMATS, normalizeOnlineModelConfig,
  type OnlineApiFormat, type OnlineModelConfig,
} from '../model-config';

const EMPTY: OnlineModelConfig = {
  baseUrl: '', apiKey: '', model: '', apiFormat: 'openai-chat',
};

export default function OnlineModelSettings({
  open, onOpenChange, current, defaultModelLabel, defaultAvailable,
  onSave, onUseDefault, onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: OnlineModelConfig | null;
  defaultModelLabel: string;
  defaultAvailable: boolean;
  onSave: (config: OnlineModelConfig) => void;
  onUseDefault: () => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState<OnlineModelConfig>(EMPTY);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(current ?? EMPTY);
    setShowKey(false);
    setError('');
  }, [current, open]);

  const update = <K extends keyof OnlineModelConfig>(key: K, value: OnlineModelConfig[K]) => {
    setDraft(previous => ({ ...previous, [key]: value }));
    setError('');
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    try {
      onSave(normalizeOnlineModelConfig(draft));
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模型配置无效。');
    }
  };

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-[1px]" />
      <Dialog.Content className="fixed inset-x-3 top-1/2 z-[61] mx-auto max-h-[calc(100dvh-2rem)] max-w-lg -translate-y-1/2 overflow-y-auto rounded-xl border border-[var(--mm-border-stone-200)] bg-[var(--mm-surface)] p-5 text-[var(--mm-text-stone-800)] shadow-xl focus:outline-none">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Dialog.Title className="text-base font-semibold">选择模型</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm leading-6 text-[var(--mm-text-stone-600)]">
              默认模型可直接使用；也可以填写自己的模型接口。
            </Dialog.Description>
          </div>
          <Dialog.Close aria-label="关闭模型设置" className="rounded-lg p-1.5 text-[var(--mm-text-stone-500)] hover:bg-[var(--mm-bg-stone-100)]">
            <X aria-hidden className="h-4 w-4" />
          </Dialog.Close>
        </div>

        <div className="mt-5 rounded-lg border border-[var(--mm-border-stone-200)] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">默认模型</p>
              <p className="mt-0.5 truncate text-xs text-[var(--mm-text-stone-500)]">{defaultModelLabel}</p>
            </div>
            <button type="button" disabled={!defaultAvailable} onClick={() => { onUseDefault(); onOpenChange(false); }}
              className="shrink-0 rounded-lg border border-[var(--mm-border-stone-300)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--mm-bg-stone-50)] disabled:cursor-not-allowed disabled:opacity-45">
              使用默认
            </button>
          </div>
          {!defaultAvailable && <p className="mt-2 text-xs leading-5 text-[var(--mm-text-amber-900)]">服务端默认模型暂未配置。</p>}
        </div>

        <form className="mt-4 space-y-4" onSubmit={save}>
          <div className="flex items-center gap-2">
            <KeyRound aria-hidden className="h-4 w-4 text-[var(--mm-text-emerald-700)]" />
            <h3 className="text-sm font-semibold">使用自己的模型</h3>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--mm-text-stone-700)]">API 格式</span>
            <select value={draft.apiFormat} onChange={event => update('apiFormat', event.target.value as OnlineApiFormat)}
              className="h-10 w-full rounded-lg border border-[var(--mm-border-stone-300)] bg-[var(--mm-surface)] px-3 text-sm focus:border-[var(--mm-border-emerald-700)] focus:outline-none">
              {ONLINE_API_FORMATS.map(format => <option key={format.id} value={format.id}>{format.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--mm-text-stone-700)]">API 地址</span>
            <input value={draft.baseUrl} onChange={event => update('baseUrl', event.target.value)}
              type="url" inputMode="url" autoComplete="off" spellCheck={false}
              placeholder="https://api.example.com/v1"
              className="h-10 w-full rounded-lg border border-[var(--mm-border-stone-300)] bg-[var(--mm-surface)] px-3 text-sm focus:border-[var(--mm-border-emerald-700)] focus:outline-none" />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--mm-text-stone-700)]">模型 ID</span>
            <input value={draft.model} onChange={event => update('model', event.target.value)}
              autoComplete="off" spellCheck={false} placeholder="例如 claude-sonnet-4-5"
              className="h-10 w-full rounded-lg border border-[var(--mm-border-stone-300)] bg-[var(--mm-surface)] px-3 text-sm focus:border-[var(--mm-border-emerald-700)] focus:outline-none" />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--mm-text-stone-700)]">API Key</span>
            <span className="relative block">
              <input value={draft.apiKey} onChange={event => update('apiKey', event.target.value)}
                type={showKey ? 'text' : 'password'} autoComplete="new-password" spellCheck={false}
                placeholder="仅用于当前页面"
                className="h-10 w-full rounded-lg border border-[var(--mm-border-stone-300)] bg-[var(--mm-surface)] pr-11 pl-3 text-sm focus:border-[var(--mm-border-emerald-700)] focus:outline-none" />
              <button type="button" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(value => !value)}
                className="absolute inset-y-0 right-1 my-auto grid h-8 w-8 place-items-center rounded-md text-[var(--mm-text-stone-500)] hover:bg-[var(--mm-bg-stone-100)]">
                {showKey ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
              </button>
            </span>
          </label>

          <div className="flex gap-2 rounded-lg bg-[var(--mm-bg-stone-50)] p-3 text-xs leading-5 text-[var(--mm-text-stone-600)]">
            <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mm-text-emerald-700)]" />
            <span>这些配置只保留在当前页面内存中，发送时用于本次云端生成；刷新或关闭页面后清除。</span>
          </div>

          {error && <p role="alert" className="text-xs leading-5 text-[var(--mm-text-amber-900)]">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div>
              {current && <button type="button" onClick={() => { onClear(); onOpenChange(false); }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-[var(--mm-text-stone-600)] hover:bg-[var(--mm-bg-stone-100)]">
                <Trash2 aria-hidden className="h-3.5 w-3.5" />清除自定义配置
              </button>}
            </div>
            <div className="flex items-center gap-2">
              <Dialog.Close className="rounded-lg px-3 py-2 text-sm text-[var(--mm-text-stone-600)] hover:bg-[var(--mm-bg-stone-100)]">取消</Dialog.Close>
              <button type="submit" className="rounded-lg bg-[var(--mm-bg-emerald-700)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--mm-bg-emerald-800)]">
                保存并切换
              </button>
            </div>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
