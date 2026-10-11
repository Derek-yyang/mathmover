'use client';

import { useEffect, useRef, useState } from 'react';
import { useScrollLock } from '@assistant-ui/react';
import { ToolGroupRoot, ToolGroupTrigger, ToolGroupContent } from '@/components/assistant-ui/elements/tool-group.aui';
import { ToolCall } from '@/components/assistant-ui/elements/tool-call';
import { elapsedLabel, toolStepLabel, type AgentExecution } from '@/lib/agent-progress';
import { executionPresentation } from '@/lib/agent-run-presentation';

const stepStatuses = { running: '进行中', returned: '已返回', error: '返回错误', unconfirmed: '未确认' };

function RecordedToolCall({ step, now }: { step: AgentExecution['steps'][number]; now: number }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lockScroll = useScrollLock(rootRef, 200);
  const duration = step.startedAt === undefined ? ''
    : ` · ${elapsedLabel(step.startedAt, step.endedAt ?? now)}`;
  const request = `工具：${step.name}${step.toolCallId ? `\n调用标识：${step.toolCallId}` : ''}`;
  return <div ref={rootRef} data-tool-step-status={step.status}>
    <ToolCall label={toolStepLabel(step.name)} activeLabel={toolStepLabel(step.name)}
      query={step.name} request={request} result={`${stepStatuses[step.status]}${duration}`}
      requestLabel="调用记录" resultLabel="执行状态"
      running={step.status === 'running'} outcome={step.status === 'running' ? undefined : step.status}
      open={open} onOpenChange={nextOpen => { lockScroll(); setOpen(nextOpen); }}
      className="min-w-0 max-w-none" />
  </div>;
}

export default function AgentExecutionProgress({ execution }: { execution: AgentExecution }) {
  const { running, label: status } = executionPresentation(execution);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(execution.startedAt);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const elapsed = elapsedLabel(execution.startedAt, execution.endedAt ?? now);
  return <ToolGroupRoot variant="ghost" open={open} onOpenChange={setOpen}
    data-agent-execution={execution.status} className="mb-2 min-w-0">
    <ToolGroupTrigger count={execution.steps.length} active={running} label={status}
      suffix={<span data-slot="run-activity-duration">· {elapsed}</span>} />
    <ToolGroupContent>
      {execution.steps.length ? <>
        <p className="text-xs text-muted-foreground">{execution.steps.length} 次工具调用</p>
        {execution.steps.map(step => <RecordedToolCall key={step.id} step={step} now={execution.endedAt ?? now} />)}
      </> : <p className="text-xs leading-5 text-muted-foreground">尚未收到工具活动。</p>}
    </ToolGroupContent>
  </ToolGroupRoot>;
}
