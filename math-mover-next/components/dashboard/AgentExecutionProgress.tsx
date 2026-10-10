'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronDown, CircleHelp, Loader2, AlertTriangle } from 'lucide-react';
import { elapsedLabel, toolStepLabel, type AgentExecution } from '@/lib/agent-progress';
import { redactAgentError } from '@/lib/agent-diagnostics';
import { executionPresentation } from '@/lib/agent-run-presentation';

export default function AgentExecutionProgress({ execution }: { execution: AgentExecution }) {
  const { running, warning, uncertain, label: status, errors, unconfirmed } = executionPresentation(execution);
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
  const elapsed = elapsedLabel(execution.startedAt, execution.endedAt ?? now);
  const Icon = running ? Loader2 : warning ? AlertTriangle : uncertain ? CircleHelp : Check;

  return <details open={open} data-agent-execution={execution.status}
    className="w-full min-w-0 text-xs text-stone-700">
    <summary onClick={event => { event.preventDefault(); setExpanded({ running, open: !open }); }}
      className="min-h-11 list-none cursor-pointer content-center rounded-lg px-2 py-2 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2">
        <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${running ? 'animate-spin motion-reduce:animate-none' : ''}`} />
        <span className="min-w-0 flex-1 break-words" aria-live="polite" aria-atomic="true">{status}</span>
        <span aria-hidden className="shrink-0 tabular-nums" title="本轮耗时">{elapsed}</span>
        <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
      </span>
    </summary>
    <div className="px-2 pb-2 pt-1">
      <p className="mb-2 text-stone-600">执行过程 · {execution.steps.length} 次工具调用{errors > 0 ? ` · ${errors} 次返回错误` : ''}{unconfirmed > 0 ? ` · ${unconfirmed} 次结果未确认` : ''}</p>
      {execution.steps.length === 0 ? <p className="leading-relaxed">尚未收到工具活动。</p>
        : <ol className="space-y-2" aria-label="工具执行步骤">
          {execution.steps.map(step => {
            const StepIcon = step.status === 'running' ? Loader2 : step.status === 'error' ? AlertTriangle
              : step.status === 'unconfirmed' ? CircleHelp : Check;
            const label = { running: '进行中', returned: '已返回', error: '返回错误', unconfirmed: '未确认' }[step.status];
            return <li key={step.id} data-tool-status={step.status} className="flex items-start gap-2 leading-relaxed">
              <StepIcon aria-hidden="true" className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${step.status === 'error' ? 'text-amber-800' : ''} ${step.status === 'running' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              <span className="min-w-0 flex-1">
                <span title={redactAgentError(step.name)}>{toolStepLabel(step.name)}</span>
              </span>
              <span className="shrink-0">{label}</span>
            </li>;
          })}
        </ol>}
    </div>
  </details>;
}
