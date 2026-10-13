export interface AgentToolStep {
  id: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'returned' | 'error' | 'unconfirmed';
  startedAt?: number;
  endedAt?: number;
}

export interface AgentExecution {
  /** stopped = 用户主动打断（不是失败，也不是正常结束） */
  status: 'running' | 'completed' | 'error' | 'unconfirmed' | 'stopped';
  startedAt: number;
  endedAt?: number;
  steps: AgentToolStep[];
}

// Arguments/results may contain screenshots, credentials and large payloads.
// Keep only observed activity metadata, not raw tool data, in chat state.
export function updateToolProgress(execution: AgentExecution, event: {
  kind?: string; name?: unknown; toolCallId?: unknown; isError?: unknown;
}, now: number): AgentExecution {
  if (event.kind !== 'tool-call' && event.kind !== 'tool-result') return execution;
  const callId = typeof event.toolCallId === 'string' && event.toolCallId.trim() ? event.toolCallId : undefined;
  const index = callId ? execution.steps.findIndex(step => step.toolCallId === callId) : -1;
  const steps = [...execution.steps];
  if (event.kind === 'tool-call') {
    // Duplicate calls must not restart the clock or overwrite a returned result.
    if (index >= 0) {
      if (steps[index].name !== '未匹配的工具结果') return execution;
      steps[index] = { ...steps[index], name: typeof event.name === 'string' ? redactAgentError(event.name.slice(0, 160)) : '未知工具' };
      return { ...execution, steps };
    }
    steps.push({ id: `step-${steps.length}`, toolCallId: callId,
      name: typeof event.name === 'string' ? redactAgentError(event.name.slice(0, 160)) : '未知工具',
      status: execution.status === 'running' ? 'running' : 'unconfirmed', startedAt: now });
  } else {
    const status = event.isError === true ? 'error' : 'returned';
    if (index >= 0) {
      // Keep an explicitly reported error even if a duplicate success follows.
      steps[index] = { ...steps[index], status: steps[index].status === 'error' ? 'error' : status,
        endedAt: steps[index].endedAt ?? now };
    } else {
      // Never guess which call a missing/unknown ID belongs to.
      steps.push({ id: `step-${steps.length}`, toolCallId: callId,
        name: '未匹配的工具结果', status, endedAt: now });
    }
  }
  return { ...execution, steps };
}

export function finishExecution(execution: AgentExecution, status: Exclude<AgentExecution['status'], 'running'>, now: number): AgentExecution {
  return { ...execution, status, endedAt: execution.endedAt ?? now,
    steps: execution.steps.map(step => step.status === 'running' ? { ...step, status: 'unconfirmed', endedAt: now } : step) };
}

export function toolStepLabel(name: string): string {
  const normalized = name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name;
  const labels: Record<string, string> = {
    ggb_get_state: '读取画板', ggb_apply: '更新构造', ggb_reset: '清空画板',
    get_expert_prompt: '读取建模规则', submit_construction: '提交构造并检查',
  };
  return Object.hasOwn(labels, normalized) ? labels[normalized] : '调用工具';
}

export function elapsedLabel(startedAt: number, endedAt: number): string {
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
import { redactAgentError } from './agent-diagnostics';
