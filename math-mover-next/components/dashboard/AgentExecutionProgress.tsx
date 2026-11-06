'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { useScrollLock } from '@assistant-ui/react';
import { RunActivity, type RunActivityEntry, type RunActivityStatus } from '@/components/assistant-ui/elements/run-activity';
import { ToolCall } from '@/components/assistant-ui/elements/tool-call';
import { elapsedLabel, toolStepLabel, type AgentExecution } from '@/lib/agent-progress';
import { executionPresentation } from '@/lib/agent-run-presentation';
import type { AgentActivityEntry, AgentMeta } from './types';

const stepStatuses = { running: '进行中', returned: '已返回', error: '返回错误', unconfirmed: '未确认' };

const RecordedToolCall = memo(function RecordedToolCall({ step, clockNow }: { step: AgentExecution['steps'][number]; clockNow?: number }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lockScroll = useScrollLock(rootRef, 200);
  const [now, setNow] = useState(step.startedAt ?? step.endedAt ?? 0);
  useEffect(() => {
    if (clockNow !== undefined || !open || step.status !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [clockNow, open, step.status]);
  const duration = step.startedAt === undefined ? ''
    : ` · ${elapsedLabel(step.startedAt, step.endedAt ?? clockNow ?? now)}`;
  const request = `工具：${step.name}${step.toolCallId ? `\n调用标识：${step.toolCallId}` : ''}`;
  return <div ref={rootRef} data-tool-step-status={step.status}>
    <ToolCall label={toolStepLabel(step.name)} activeLabel={toolStepLabel(step.name)}
      query={step.name} request={request} result={`${stepStatuses[step.status]}${duration}`}
      requestLabel="调用记录" resultLabel="执行状态"
      running={step.status === 'running'} outcome={step.status === 'running' ? undefined : step.status}
      open={open} onOpenChange={nextOpen => { lockScroll(); if (nextOpen && clockNow === undefined) setNow(Date.now()); setOpen(nextOpen); }}
      className="min-w-0 max-w-none" />
  </div>;
});

function ExecutionDuration({ execution, retry, clockNow }: { execution: AgentExecution; retry?: AgentMeta['retry']; clockNow?: number }) {
  // The empty summary becomes a disclosure when the first activity arrives.
  // Its clock may remount; keep deriving elapsed time from the persisted start.
  const [now, setNow] = useState(() => execution.endedAt ?? clockNow ?? Date.now());
  useEffect(() => {
    if (clockNow !== undefined || execution.status !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [clockNow, execution.status]);
  const currentTime = clockNow ?? now;
  const seconds = retry ? Math.max(0, Math.ceil((retry.retryAt - currentTime) / 1000)) : 0;
  const wait = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return <span data-slot="run-activity-duration">· {retry && execution.status === 'running'
    ? seconds > 0 ? `${wait}后重试` : '正在重试…'
    : elapsedLabel(execution.startedAt, execution.endedAt ?? currentTime)}</span>;
}

const statuses: Record<AgentExecution['status'], RunActivityStatus> = {
  running: 'running', completed: 'complete', error: 'error', unconfirmed: 'incomplete', stopped: 'cancelled',
};

interface AgentExecutionProgressProps {
  execution: AgentExecution;
  activity?: AgentActivityEntry[];
  retry?: AgentMeta['retry'];
  /** Optional playback clock; omitted for live agent runs. */
  clockNow?: number;
}

export default function AgentExecutionProgress({ execution, activity, retry, clockNow }: AgentExecutionProgressProps) {
  const { label, errors, unconfirmed, running } = executionPresentation(execution);
  const waiting = execution.status === 'running' ? retry : undefined;
  const statusLabel = waiting ? waiting.reason === 'rate_limit' ? '模型服务暂时受限' : '模型服务暂时不可用' : label;
  // Manual choices apply only to this run and phase. Finishing a run folds its
  // history with the panel's exit transition; it can still be opened again.
  const [expansion, setExpansion] = useState<{ startedAt: number; running: boolean; open: boolean } | null>(null);
  const open = expansion?.startedAt === execution.startedAt && expansion.running === running
    ? expansion.open : running;
  const setOpen = (value: boolean) => setExpansion({ startedAt: execution.startedAt, running, open: value });
  const rootRef = useRef<HTMLDivElement>(null);
  const lockScroll = useScrollLock(rootRef, 250);
  const steps = new Map(execution.steps.map(step => [step.id, step]));
  const entries: RunActivityEntry[] = (activity ?? execution.steps.map(step => ({ id: `tool-${step.id}`, kind: 'tool' as const, stepId: step.id })))
    .flatMap<RunActivityEntry>(entry => {
      if (entry.kind === 'text') return entry.phase === 'commentary'
        ? [{ id: entry.id, kind: 'commentary' as const, label: '', content:
          <p data-slot="run-commentary" className="whitespace-pre-wrap leading-6 text-[var(--mm-text-stone-600)]">{entry.text}</p> }] : [];
      const step = steps.get(entry.stepId);
      return step ? [{ id: entry.id, kind: 'tool' as const, label: toolStepLabel(step.name), content: <RecordedToolCall step={step} clockNow={clockNow} /> }] : [];
    });
  return <div ref={rootRef} data-agent-execution={execution.status} className="mb-2 min-w-0">
    <RunActivity status={statuses[execution.status]} statusLabel={statusLabel} currentActivityLabel={statusLabel}
      durationLabel={<ExecutionDuration key={waiting?.retryAt ?? 'elapsed'} execution={execution} retry={waiting} clockNow={clockNow} />}
      entries={entries} open={open} onOpenChange={value => { lockScroll(); setOpen(value); }}
      attention={(errors > 0 || (execution.status !== 'running' && unconfirmed > 0)) && <p role="status" className="text-xs leading-5 text-[var(--mm-text-amber-900)]">
        {errors > 0 ? `${errors} 次工具调用返回错误。` : `${unconfirmed} 次工具调用的结果未确认。`}
        <button type="button" className="ml-1 rounded underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]"
          onClick={() => { lockScroll(); setOpen(true); }}>查看过程</button>
      </p>} />
  </div>;
}
