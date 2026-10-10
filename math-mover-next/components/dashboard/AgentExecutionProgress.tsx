'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronDown, CircleHelp, Loader2, AlertTriangle } from 'lucide-react';
import { elapsedLabel, toolStepLabel, type AgentExecution } from '@/lib/agent-progress';
import { redactAgentError } from '@/lib/agent-diagnostics';

export default function AgentExecutionProgress({ execution }: { execution: AgentExecution }) {
  const running = execution.status === 'running';
  // Explicit expansion is scoped to the current phase: completing a run closes
  // it, but users can reopen the finished process without an effect reset.
  const [expanded, setExpanded] = useState<{ running: boolean; open: boolean } | null>(null);
  const open = expanded?.running === running ? expanded.open : false;
  const [now, setNow] = useState(execution.startedAt);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const hasError = execution.steps.some(step => step.status === 'error');
  const hasUnknown = execution.steps.some(step => step.status === 'unconfirmed');
  const latest = execution.steps.findLast(step => step.status === 'running');
  const status = running
    ? latest?.status === 'running' ? `正在${toolStepLabel(latest.name)}` : '等待 Agent 回复'
    : execution.status === 'error' ? '调用中断'
    : execution.status === 'unconfirmed' || hasUnknown ? '有结果未确认'
    : hasError ? '工具返回错误' : '本轮已结束';
  const elapsed = elapsedLabel(execution.startedAt, execution.endedAt ?? now);
  const Icon = running ? Loader2 : execution.status === 'error' || hasError ? AlertTriangle
    : execution.status === 'unconfirmed' || hasUnknown ? CircleHelp : Check;

  return <details open={open} data-agent-execution={execution.status}
    className="w-full min-w-0 text-xs text-stone-600">
    <summary onClick={event => { event.preventDefault(); setExpanded({ running, open: !open }); }}
      className="list-none cursor-pointer rounded-lg px-2 py-2 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2">
        <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${running ? 'animate-spin motion-reduce:animate-none' : ''}`} />
        <span className="min-w-0 flex-1 break-words">执行过程 · {status}</span>
        <span className="shrink-0 tabular-nums" title="浏览器观测的本轮耗时">{elapsed}</span>
        <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </span>
    </summary>
    <div className="px-2 pb-2 pt-1">
      {execution.steps.length === 0 ? <p className="leading-relaxed">尚未收到工具步骤；这里只显示 Agent 实际返回的活动。</p>
        : <ol className="space-y-2" aria-label="工具执行步骤">
          {execution.steps.map(step => {
            const StepIcon = step.status === 'running' ? Loader2 : step.status === 'error' ? AlertTriangle
              : step.status === 'unconfirmed' ? CircleHelp : Check;
            const label = { running: '执行中', returned: '已返回', error: '返回错误', unconfirmed: '结果未确认' }[step.status];
            return <li key={step.id} data-tool-status={step.status} className="flex items-start gap-2 leading-relaxed">
              <StepIcon aria-hidden="true" className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${step.status === 'error' ? 'text-amber-800' : ''} ${step.status === 'running' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              <span className="min-w-0 flex-1">
                <span>{toolStepLabel(step.name)}</span>
                <span className="block break-all text-[11px]">{redactAgentError(step.name)}</span>
              </span>
              <span className="shrink-0">{label}</span>
            </li>;
          })}
        </ol>}
      {!running && execution.steps.length > 0 && <p className="mt-2 leading-relaxed">“已返回”表示收到工具结果，不代表构造已通过检查。</p>}
    </div>
  </details>;
}
