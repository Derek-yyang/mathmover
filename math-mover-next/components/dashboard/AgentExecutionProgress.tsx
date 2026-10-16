'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { useScrollLock } from '@assistant-ui/react';
import { RunActivity, type RunActivityEntry, type RunActivityStatus } from '@/components/assistant-ui/elements/run-activity';
import { ToolCall } from '@/components/assistant-ui/elements/tool-call';
import { elapsedLabel, toolStepLabel, type AgentExecution } from '@/lib/agent-progress';
import { executionPresentation } from '@/lib/agent-run-presentation';
import type { AgentActivityEntry } from './types';

const stepStatuses = { running: '进行中', returned: '已返回', error: '返回错误', unconfirmed: '未确认' };

const RecordedToolCall = memo(function RecordedToolCall({ step }: { step: AgentExecution['steps'][number] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lockScroll = useScrollLock(rootRef, 200);
  const [now, setNow] = useState(step.startedAt ?? step.endedAt ?? 0);
  useEffect(() => {
    if (!open || step.status !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open, step.status]);
  const duration = step.startedAt === undefined ? ''
    : ` · ${elapsedLabel(step.startedAt, step.endedAt ?? now)}`;
  const request = `工具：${step.name}${step.toolCallId ? `\n调用标识：${step.toolCallId}` : ''}`;
  return <div ref={rootRef} data-tool-step-status={step.status}>
    <ToolCall label={toolStepLabel(step.name)} activeLabel={toolStepLabel(step.name)}
      query={step.name} request={request} result={`${stepStatuses[step.status]}${duration}`}
      requestLabel="调用记录" resultLabel="执行状态"
      running={step.status === 'running'} outcome={step.status === 'running' ? undefined : step.status}
      open={open} onOpenChange={nextOpen => { lockScroll(); if (nextOpen) setNow(Date.now()); setOpen(nextOpen); }}
      className="min-w-0 max-w-none" />
  </div>;
});

function ExecutionDuration({ execution }: { execution: AgentExecution }) {
  // The empty summary becomes a disclosure when the first activity arrives.
  // Its clock may remount; keep deriving elapsed time from the persisted start.
  const [now, setNow] = useState(() => execution.endedAt ?? Date.now());
  useEffect(() => {
    if (execution.status !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [execution.status]);
  return <span data-slot="run-activity-duration">· {elapsedLabel(execution.startedAt, execution.endedAt ?? now)}</span>;
}

const statuses: Record<AgentExecution['status'], RunActivityStatus> = {
  running: 'running', completed: 'complete', error: 'error', unconfirmed: 'incomplete', stopped: 'cancelled',
};

export default function AgentExecutionProgress({ execution, activity }: { execution: AgentExecution; activity?: AgentActivityEntry[] }) {
  const { label, errors, unconfirmed } = executionPresentation(execution);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lockScroll = useScrollLock(rootRef, 200);
  const steps = new Map(execution.steps.map(step => [step.id, step]));
  const entries: RunActivityEntry[] = (activity ?? execution.steps.map(step => ({ id: `tool-${step.id}`, kind: 'tool' as const, stepId: step.id })))
    .flatMap<RunActivityEntry>(entry => {
      if (entry.kind === 'text') return entry.phase === 'commentary' || entry.phase === 'pending'
        ? [{ id: entry.id, kind: 'commentary' as const, label: '', content:
          <p data-slot="run-commentary" className="whitespace-pre-wrap leading-6 text-[var(--mm-text-stone-600)]">{entry.text}</p> }] : [];
      const step = steps.get(entry.stepId);
      return step ? [{ id: entry.id, kind: 'tool' as const, label: toolStepLabel(step.name), content: <RecordedToolCall step={step} /> }] : [];
    });
  return <div ref={rootRef} data-agent-execution={execution.status} className="mb-2 min-w-0">
    <RunActivity status={statuses[execution.status]} statusLabel={label} currentActivityLabel={label}
      durationLabel={<ExecutionDuration execution={execution} />}
      entries={entries} open={open} onOpenChange={value => { lockScroll(); setOpen(value); }}
      attention={(errors > 0 || (execution.status !== 'running' && unconfirmed > 0)) && <p role="status" className="text-xs leading-5 text-[var(--mm-text-amber-900)]">
        {errors > 0 ? `${errors} 次工具调用返回错误。` : `${unconfirmed} 次工具调用的结果未确认。`}
        <button type="button" className="ml-1 rounded underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]"
          onClick={() => { lockScroll(); setOpen(true); }}>查看过程</button>
      </p>} />
  </div>;
}
