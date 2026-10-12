'use client';

import { useId, useState } from 'react';
import { Check, ChevronDown, ExternalLink, RefreshCw } from 'lucide-react';
import { useAgentRuntimeState } from '../dashboard/AgentRuntimeState';
import type { RuntimeOption } from '../dashboard/AgentChatPanel';
import { agentGuide, groupAgents, INSTALL_STEPS, INSTALL_PATH_HINT } from '@/lib/agent-settings';
import AgentDiagnosticNotice from '../dashboard/AgentDiagnosticNotice';

const action = 'rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';
const link = 'inline-flex items-center gap-1.5 rounded text-sm font-medium text-emerald-800 underline decoration-emerald-800/30 underline-offset-4 hover:decoration-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700';

function GuideLink({ id, name, install = false }: { id: string; name: string; install?: boolean }) {
  const guide = agentGuide(id);
  if (!guide) return null;
  return (
    <a className={link} href={install ? guide.installUrl : guide.docsUrl} target="_blank" rel="noopener noreferrer"
      aria-label={`${name} ${install ? '安装页' : '配置文档'}（新窗口打开）`}>
      {install ? '安装' : '配置文档'}<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

function AgentRow({ runtime, selected, disabled, onSelect }: {
  runtime: RuntimeOption; selected: boolean; disabled: boolean; onSelect: () => void;
}) {
  const detailsId = useId();
  const guide = agentGuide(runtime.id);
  const { runtimeFailures, detecting, refreshRuntimes } = useAgentRuntimeState();
  const failure = runtimeFailures.get(runtime.id);
  return (
    <li className={'rounded-xl border ' + (selected ? 'border-emerald-700/40 bg-emerald-50/50' : 'border-stone-200')}>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-stone-900">{runtime.name}</p>
          <p className="mt-1 break-words text-xs leading-5 text-stone-600">
            {runtime.usable ? runtime.version || '版本信息未提供' : '未检测到命令行程序'}
          </p>
          {runtime.versionWarning && <p className="mt-1 break-words text-xs leading-5 text-amber-800">{runtime.versionWarning}</p>}
        </div>
        <button type="button" className={action + (selected ? ' flex shrink-0 items-center gap-1.5 text-emerald-800 disabled:opacity-100' : ' shrink-0 text-stone-700 hover:bg-stone-100')}
          disabled={disabled || selected || !runtime.usable} onClick={onSelect}
          aria-label={(selected ? '当前使用 ' : '使用 ') + runtime.name}
          aria-expanded={selected} aria-controls={selected ? detailsId : undefined}>
          {selected ? <><Check className="h-4 w-4" aria-hidden="true" />当前使用</> : '使用'}
        </button>
      </div>
      {selected && (
        <div id={detailsId} className="agent-settings-detail border-t border-stone-200 px-4 py-3 text-sm leading-6">
          {failure && <div className="mb-3"><AgentDiagnosticNotice diagnostic={failure} historical
            detecting={detecting} onRescan={() => void refreshRuntimes()} /></div>}
          {!runtime.usable && <p className="mb-2 text-amber-900">当前选择暂未检测到。请安装或检查环境后刷新；不会自动切换。</p>}
          <p className="font-medium text-stone-800">模型与账号在 {runtime.name} 中配置</p>
          <p className="mt-1 text-stone-600">{guide?.configure || '请在该 Agent 中完成账号与模型配置，再回到聊天区使用。'}</p>
          <div className="mt-2"><GuideLink id={runtime.id} name={runtime.name} install={!runtime.usable} /></div>
        </div>
      )}
    </li>
  );
}

export default function AgentSettings() {
  const { runtimes, activeRuntimeId, detecting, detectionError, runtimeFailures, busy, selectRuntime, refreshRuntimes } = useAgentRuntimeState();
  const groups = groupAgents(runtimes, activeRuntimeId);
  // User disclosure preference is independent of detection results. If there
  // are no detected agents, show setup guidance by default instead of hiding it.
  const [unavailableOpen, setUnavailableOpen] = useState<boolean | null>(null);
  const open = unavailableOpen ?? groups.detected.length === 0;
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-stone-900">课件生成 Agent</h3>
        <p className="mt-2 text-sm leading-6 text-stone-600">选择本机的第三方 Agent 来生成课件。模型、账号和密钥由对应 Agent 管理。</p>
      </div>

      <section aria-labelledby="detected-agents-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 id="detected-agents-heading" className="text-sm font-medium text-stone-800">已检测到 <span className="ml-1 text-stone-600">{groups.detected.length}</span></h4>
          <button type="button" className={action + ' flex items-center gap-2 text-stone-700 hover:bg-stone-100'}
            onClick={() => void refreshRuntimes()} disabled={detecting}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />{detecting ? '正在检测…' : '刷新检测'}
          </button>
        </div>
        {detectionError && <div className="mb-3"><AgentDiagnosticNotice diagnostic={detectionError}
          detecting={detecting} onRescan={() => void refreshRuntimes()} /></div>}
        {detecting && !runtimes.length ? (
          <div role="status" className="space-y-3 rounded-lg bg-stone-100 p-4 text-sm text-stone-600">
            正在查找已安装的 Agent…
            <div aria-hidden="true" className="h-3 w-2/3 rounded bg-stone-200" />
            <div aria-hidden="true" className="h-3 w-1/2 rounded bg-stone-200" />
          </div>
        ) : groups.detected.length ? (
          <ul className="space-y-2">
            {groups.detected.map(runtime => <AgentRow key={runtime.id} runtime={runtime} selected={runtime.id === activeRuntimeId}
              disabled={busy || detecting} onSelect={() => selectRuntime(runtime.id)} />)}
          </ul>
        ) : !detectionError ? (
          <p className="rounded-lg bg-stone-100 px-4 py-3 text-sm leading-6 text-stone-600">尚未检测到 Agent。请先安装并配置你要使用的 Agent，确认命令行程序可运行后，点击“刷新检测”。</p>
        ) : null}
      </section>

      {groups.currentUnavailable && (
        <section aria-label="当前选择暂未检测到">
          <h4 className="mb-3 text-sm font-medium text-stone-800">当前选择</h4>
          <ul><AgentRow runtime={groups.currentUnavailable} selected disabled onSelect={() => {}} /></ul>
        </section>
      )}
      {groups.missingSelection && <p className="text-sm leading-6 text-amber-900">当前选择：<span className="break-all">{groups.missingSelection}</span>（尚未检测到，不会自动切换）。请检查安装或选择其他已检测到的 Agent。</p>}
      {!runtimes.some(runtime => runtime.id === activeRuntimeId) && runtimeFailures.get(activeRuntimeId) &&
        <AgentDiagnosticNotice diagnostic={runtimeFailures.get(activeRuntimeId)!} historical
          detecting={detecting} onRescan={() => void refreshRuntimes()} />}

      {groups.unavailable.length > 0 && (
        <details open={open} className="border-t border-stone-200 pt-4">
          <summary onClick={event => { event.preventDefault(); setUnavailableOpen(!open); }}
            className="flex cursor-pointer list-none items-center gap-2 rounded py-1 text-sm font-medium text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 [&::-webkit-details-marker]:hidden">
            <ChevronDown className={'h-4 w-4 ' + (open ? '' : '-rotate-90')} aria-hidden="true" />
            可安装 <span className="text-stone-600">{groups.unavailable.length}</span>
          </summary>
          <div className="mt-2">
            <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-stone-600">
              {INSTALL_STEPS.map(step => <li key={step}>{step}</li>)}
            </ol>
            <ul className="mt-3 divide-y divide-stone-200">
              {groups.unavailable.map(runtime => (
                <li key={runtime.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0 break-words text-sm font-medium text-stone-800">{runtime.name}</span>
                  <span className="flex shrink-0 items-center gap-4">
                    <GuideLink id={runtime.id} name={runtime.name} install />
                    <GuideLink id={runtime.id} name={runtime.name} />
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 rounded-lg bg-stone-100 px-3 py-2 text-xs leading-5 text-stone-600">{INSTALL_PATH_HINT}</p>
          </div>
        </details>
      )}

      <div className="border-t border-stone-200 pt-4 text-xs leading-5 text-stone-600">
        <p role="status">{busy ? 'Agent 正在执行任务，结束后可切换。' : '选择立即生效，并与聊天区同步；不会自动切换到其他 Agent。'}</p>
        <p className="mt-1">检测仅确认命令行程序可运行，不代表已登录或模型服务可用。</p>
      </div>
    </div>
  );
}
