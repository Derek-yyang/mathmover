'use client';

import { RotateCw } from 'lucide-react';
import type { GgbConnectionStatus } from '@/lib/ggb-connection';

const states = {
  loading: { label: '画板加载中', description: '正在加载画板，加载完成后连接本地服务。', dot: 'bg-[var(--mm-bg-stone-400)]' },
  connecting: { label: '连接中…', description: '正在连接本地服务，连接成功后 Agent 可控制画板。', dot: 'bg-[var(--mm-bg-amber-600)]' },
  connected: { label: '已连接', description: '画板已连接本地服务，Agent 可控制当前画板。', dot: 'bg-[var(--mm-bg-emerald-600)]' },
  disconnected: { label: '未连接', description: '画板未连接本地服务，正在自动重连。请确认本地服务已启动；画板仍可手动操作。', dot: 'bg-[var(--mm-bg-amber-600)]' },
};

export default function BoardConnectionStatus({ status, onReconnect }: {
  status: GgbConnectionStatus; onReconnect?: () => void;
}) {
  const state = states[status];
  return <div className="flex shrink-0 items-center gap-1.5" data-board-connection={status}>
    <span role="status" aria-label="画板连接状态" title={state.description}
      className={`flex items-center gap-1.5 text-xs ${status === 'disconnected' ? 'text-[var(--mm-text-amber-800)]' : 'text-[var(--mm-text-stone-600)]'}`}>
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${state.dot}`} />
      <span className="@max-[560px]:sr-only">{state.label}</span>
    </span>
    {status === 'disconnected' && onReconnect && <button type="button" onClick={onReconnect}
      aria-label="重新连接画板" title="重新连接画板"
      className="rounded p-1 text-[var(--mm-text-stone-600)] hover:bg-[var(--mm-bg-stone-100)] hover:text-[var(--mm-text-stone-800)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]">
      <RotateCw aria-hidden className="h-3 w-3" />
    </button>}
  </div>;
}
