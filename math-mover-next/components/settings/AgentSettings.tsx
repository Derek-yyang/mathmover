'use client';

/**
 * 「本机 CLI」设置面 —— 卡片化布局（对比评审 2026-10-13 后重构）。
 *
 * 信息设计目标：老师两秒回答「在用哪个 agent、跑什么模型、能不能跑通」。
 *   卡片 = 徽标 + 名称 + 官方来源副标题 + 版本 · 状态芯片 + 测试 + 使用；
 *   模型/档位行内可改（与聊天区 composer 选择器写同一份状态）；
 *   选中卡展开配置指引与失败诊断；安装向导收进折叠组。
 * 诚实文案全部保留——那是这套界面的信任资产。
 */

import { useId, useState } from 'react';
import { Check, ChevronDown, ExternalLink, Loader2, SquareTerminal } from 'lucide-react';
import { useAgentRuntimeState } from '../dashboard/AgentRuntimeState';
import type { RuntimeOption } from '../dashboard/AgentChatPanel';
import { agentGuide, groupAgents, INSTALL_STEPS, INSTALL_PATH_HINT } from '@/lib/agent-settings';
import { effortDisplay, type EffortOption } from '@/lib/agent-picker';
import AgentDiagnosticNotice from '../dashboard/AgentDiagnosticNotice';

const action = 'rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';
const link = 'inline-flex items-center gap-1.5 rounded text-sm font-medium text-emerald-800 underline decoration-emerald-800/30 underline-offset-4 hover:decoration-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700';
const selectControl = 'mt-1 w-full max-w-64 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-800 focus-visible:outline-2 focus-visible:outline-emerald-700';

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

function StatusChip({ runtime }: { runtime: RuntimeOption }) {
  const tone = !runtime.usable ? 'bg-stone-200 text-stone-700'
    : runtime.authStatus === 'ok' ? 'bg-emerald-100 text-emerald-900'
    : runtime.authStatus === 'missing' ? 'bg-amber-100 text-amber-900'
    : 'bg-stone-200 text-stone-700';
  const label = !runtime.usable ? '起不来' : runtime.authStatus === 'ok' ? '已登录'
    : runtime.authStatus === 'missing' ? '未登录' : '已安装';
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>;
}

type TestState = { running: boolean; result?: { ok: boolean; message: string } };

async function runTest(runtimeId: string, setState: (s: TestState) => void) {
  setState({ running: true });
  try {
    const res = await fetch('/api/agent/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runtimeId }),
    });
    const data = await res.json() as { ok?: boolean; message?: string };
    setState({ running: false, result: { ok: data.ok === true, message: data.message ?? (res.ok ? '测试完成。' : `测试失败（HTTP ${res.status}）。`) } });
  } catch (e) {
    setState({ running: false, result: { ok: false, message: `测试请求失败：${e instanceof Error ? e.message : String(e)}` } });
  }
}

function ModelGlance({ runtime }: { runtime: RuntimeOption }) {
  const { modelFor, effortFor } = useAgentRuntimeState();
  const models = runtime.models?.list ?? [];
  const modelId = modelFor(runtime.id);
  const model = models.find(m => m.id === modelId) ?? models[0];
  if (!model) return null;
  const effortId = effortFor(runtime.id, model.id);
  const effort = (model.reasoningOptions ?? []).find(o => o.id === effortId);
  return <p className="mt-1 truncate text-xs leading-5 text-stone-600">
    模型 <span className="text-stone-800">{model.label}</span>
    {effort ? <> · 档位 <span className="text-stone-800">{effort.label}</span></> : null}
  </p>;
}

function ModelSelects({ runtime }: { runtime: RuntimeOption }) {
  const { selectedModel, selectedEffort, selectModel, selectEffort } = useAgentRuntimeState();
  const models = runtime.models?.list ?? [];
  const current = models.find(m => m.id === selectedModel) ?? models[0];
  const effort = effortDisplay(current?.reasoningOptions as EffortOption[] | undefined, selectedEffort);
  return (
    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
      <label className="block min-w-40 flex-1 text-xs font-medium text-stone-600">
        模型
        <span className="ml-1.5 font-normal text-stone-600">{runtime.models?.source === 'live' ? '来自实时发现' : '兜底提示'}</span>
        <select className={selectControl} aria-label="选择模型" value={current?.id ?? 'default'}
          onChange={event => selectModel(event.target.value)}>
          {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      {effort ? (
        <label className="block min-w-40 flex-1 text-xs font-medium text-stone-600">
          推理档位
          <span className="ml-1.5 font-normal text-stone-600">{effort.pinned ? '' : '（默认）'}</span>
          <select className={selectControl} aria-label="选择推理档位" value={effort.option.id}
            onChange={event => selectEffort(event.target.value)}>
            {(current?.reasoningOptions ?? []).map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>
      ) : (
        <div className="min-w-40 flex-1 text-xs">
          <p className="font-medium text-stone-600">推理档位</p>
          <p className="mt-2 text-sm text-stone-500">由 Agent 配置决定</p>
        </div>
      )}
    </div>
  );
}

function AgentCard({ runtime, selected }: { runtime: RuntimeOption; selected: boolean }) {
  const detailsId = useId();
  const guide = agentGuide(runtime.id);
  const { runtimeFailures, detecting, refreshRuntimes, busy, selectRuntime } = useAgentRuntimeState();
  const failure = runtimeFailures.get(runtime.id);
  const [test, setTest] = useState<TestState>({ running: false });

  return (
    <li className={`rounded-xl border transition-colors motion-reduce:transition-none ${selected ? 'border-emerald-700/40 bg-emerald-50/50' : 'border-stone-200 bg-white hover:border-stone-300'}`}>
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-700" aria-hidden="true">
          <SquareTerminal className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="min-w-0 truncate text-base font-semibold text-stone-900">{runtime.name}</span>
            {guide && <span className="text-xs font-medium text-stone-600">· {guide.subtitle}</span>}
            {runtime.models && runtime.models.list.length > 1 && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">多种模型</span>
            )}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-stone-600">
            <span className="tabular-nums">{runtime.version || '版本信息未提供'}</span>
            <StatusChip runtime={runtime} />
          </p>
          {runtime.versionWarning && <p className="mt-1 break-words text-xs leading-5 text-amber-800">{runtime.versionWarning}</p>}
          {!selected && <ModelGlance runtime={runtime} />}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" aria-label={`测试 ${runtime.name}`} title="测试能否连通并可用"
            disabled={test.running || detecting} onClick={() => void runTest(runtime.id, setTest)}
            className={action + ' text-stone-700 hover:bg-stone-100'}>
            {test.running ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />测试中…</> : '测试'}
          </button>
          <button type="button"
            className={action + (selected ? ' flex items-center gap-1.5 text-emerald-800' : ' text-stone-700 hover:bg-stone-100')}
            disabled={busy || detecting || selected || !runtime.usable}
            onClick={() => selectRuntime(runtime.id)}
            aria-label={(selected ? '当前使用 ' : '使用 ') + runtime.name}
            aria-expanded={selected} aria-controls={selected ? detailsId : undefined}>
            {selected ? <><Check className="h-4 w-4" aria-hidden="true" />当前使用</> : '使用'}
          </button>
        </div>
      </div>
      {selected && (
        <div id={detailsId} className="border-t border-stone-200 px-4 pb-4 pt-3">
          <ModelSelects runtime={runtime} />
          {failure && <div className="mt-3"><AgentDiagnosticNotice diagnostic={failure} historical
            detecting={detecting} onRescan={() => void refreshRuntimes()} /></div>}
          {!runtime.usable && <p className="mt-3 text-sm text-amber-900">当前选择暂未检测到。请安装或检查环境后刷新；不会自动切换。</p>}
          <p className="mt-3 max-w-[68ch] text-sm leading-6 text-stone-600">{guide?.configure ?? '请在该 Agent 中完成账号与模型配置，再回到聊天区使用。'}</p>
          <div className="mt-2"><GuideLink id={runtime.id} name={runtime.name} install={!runtime.usable} /></div>
        </div>
      )}
      {test.result && (
        <p role="status" className={`border-t border-stone-200 px-4 py-2.5 text-xs leading-5 ${test.result.ok ? 'text-emerald-800' : 'text-amber-900'}`}>
          测试结果：{test.result.message}
        </p>
      )}
    </li>
  );
}

export default function AgentSettings() {
  const { runtimes, activeRuntimeId, detecting, detectionError, runtimeFailures, refreshRuntimes } = useAgentRuntimeState();
  const groups = groupAgents(runtimes, activeRuntimeId);
  // BYOK 是「API 提供商」Tab 的居民，不进本机 CLI 卡片列表
  const detected = groups.detected.filter(runtime => runtime.id !== 'byok');
  const unavailable = groups.unavailable.filter(runtime => runtime.id !== 'byok');
  const currentUnavailable = groups.currentUnavailable?.id === 'byok' ? undefined : groups.currentUnavailable;
  // 没有已装 CLI 时安装引导直接展开——空态要教学，不是「什么都没有」
  const [installOpen, setInstallOpen] = useState<boolean | null>(null);
  const open = installOpen ?? detected.length === 0;

  return (
    <div>
      <p className="max-w-[68ch] text-sm leading-6 text-stone-600">选择本机的第三方 Agent 来生成课件。模型、账号和密钥由对应 Agent 管理。</p>

      {detectionError && <div className="mt-4"><AgentDiagnosticNotice diagnostic={detectionError}
        detecting={detecting} onRescan={() => void refreshRuntimes()} /></div>}
      {groups.missingSelection && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
        当前选择：<span className="break-all">{groups.missingSelection}</span>（尚未检测到，不会自动切换）。请检查安装或选择其他已检测到的 Agent。
      </p>}
      {!runtimes.some(runtime => runtime.id === activeRuntimeId) && runtimeFailures.get(activeRuntimeId) &&
        <div className="mt-4"><AgentDiagnosticNotice diagnostic={runtimeFailures.get(activeRuntimeId)!} historical
          detecting={detecting} onRescan={() => void refreshRuntimes()} /></div>}
      {currentUnavailable && <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-stone-600">当前选择</p>
        <ul><AgentCard runtime={currentUnavailable} selected /></ul>
      </div>}

      <section aria-label="已检测到的 Agent" className="mt-5">
        <h3 className="mb-3 text-sm font-medium text-stone-800">已检测到 <span className="ml-1 font-semibold tabular-nums text-stone-900">{detected.length}</span></h3>
        {detecting && !runtimes.length ? (
          <ul className="space-y-3" aria-label="正在查找已安装的 Agent">
            {[0, 1, 2].map(i => (
              <li key={i} className="rounded-xl border border-stone-200 bg-white p-4" role="status">
                <span className="sr-only">正在查找已安装的 Agent…</span>
                <div aria-hidden="true" className="h-4 w-1/3 rounded bg-stone-200" />
                <div aria-hidden="true" className="mt-2 h-3 w-1/2 rounded bg-stone-100" />
              </li>
            ))}
          </ul>
        ) : detected.length ? (
          <ul className="space-y-3">
            {detected.map(runtime => <AgentCard key={runtime.id} runtime={runtime} selected={runtime.id === activeRuntimeId} />)}
          </ul>
        ) : !detectionError ? (
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="text-sm leading-6 text-stone-600">尚未检测到已安装的 Agent。下面的可安装列表里有获取它们的入口。</p>
          </div>
        ) : null}
      </section>

      {unavailable.length > 0 && (
        <details open={open} className="mt-6">
          <summary onClick={event => { event.preventDefault(); setInstallOpen(!open); }}
            className="flex cursor-pointer list-none items-center gap-2 rounded py-1 text-sm font-medium text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 [&::-webkit-details-marker]:hidden">
            <ChevronDown className={'h-4 w-4 transition-transform motion-reduce:transition-none ' + (open ? 'rotate-0' : '-rotate-90')} aria-hidden="true" />
            可安装 <span className="text-stone-600">{unavailable.length}</span>
          </summary>
          <div className="mt-2">
            <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-stone-600">
              {INSTALL_STEPS.map(step => <li key={step}>{step}</li>)}
            </ol>
            <ul className="mt-3 space-y-2">
              {unavailable.map(runtime => (
                <li key={runtime.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-stone-100 px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium text-stone-800">{runtime.name}</span>
                    {agentGuide(runtime.id) && <span className="block text-xs text-stone-600">· {agentGuide(runtime.id)!.subtitle}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-4">
                    <GuideLink id={runtime.id} name={runtime.name} install />
                    <GuideLink id={runtime.id} name={runtime.name} />
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 max-w-[68ch] rounded-lg bg-stone-100 px-3 py-2 text-xs leading-5 text-stone-600">{INSTALL_PATH_HINT}</p>
          </div>
        </details>
      )}

      <p className="mt-6 max-w-[68ch] border-t border-stone-200 pt-4 text-xs leading-5 text-stone-600">
        检测仅确认命令行程序可运行，不代表已登录或模型服务可用；点「测试」可分别确认。选择立即生效，不会自动切换到其他 Agent。
      </p>
    </div>
  );
}
