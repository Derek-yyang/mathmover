import type { AgentMeta } from '@/components/dashboard/types';
import type { AgentExecution } from './agent-progress';
import { toolStepLabel } from './agent-progress';
import { toolBaseName } from './agent-run-meta';

/**
 * 会改动画布的工具（按**工具名**判，不按展示标签——标签是给人看的措辞，
 * 改一次文案就会让这里静默失效，实测踩过：把 ggb_apply 的标签从「更新构造」
 * 改成「更新构造并自检」，这套判断就再也认不出它了）。
 */
const CONSTRUCTION_TOOLS = new Set(['ggb_apply', 'ggb_reset']);
const STEP_OUTCOMES = { running: '进行中', returned: '已返回', error: '返回错误', unconfirmed: '未确认' };

/** Presentation only: returned tools are not evidence of a valid construction. */
export function executionPresentation(execution: AgentExecution) {
  const errors = execution.steps.filter(step => step.status === 'error').length;
  const unconfirmed = execution.steps.filter(step => step.status === 'unconfirmed').length;
  const current = execution.steps.findLast(step => step.status === 'running');
  // Keep a fast call readable after its result, without claiming it is still
  // running. Concurrent results may finish in a different order to their calls.
  const recent = execution.steps.reduce<AgentExecution['steps'][number] | undefined>((latest, step) => {
    if (step.status === 'running') return latest;
    return !latest || (step.endedAt ?? step.startedAt ?? 0) >= (latest.endedAt ?? latest.startedAt ?? 0) ? step : latest;
  }, undefined);
  const running = execution.status === 'running';
  const warning = execution.status === 'error' || errors > 0;
  const uncertain = execution.status === 'unconfirmed' || unconfirmed > 0;
  const label = running ? current ? `正在${toolStepLabel(current.name)}…`
    : recent ? `${toolStepLabel(recent.name)} · ${STEP_OUTCOMES[recent.status]}` : '处理中…'
    : execution.status === 'stopped' ? '已停止 · 本轮未跑完'
    : execution.status === 'error' ? '本轮中断'
    : warning ? '本轮结束 · 有工具返回错误'
    : uncertain ? '本轮结束 · 有结果未确认' : '本轮已结束';
  return { running, warning, uncertain, label, errors, unconfirmed };
}

export function runResultPresentation(meta?: AgentMeta) {
  if (!meta || meta.status === 'generating' || meta.execution?.status === 'running') return null;
  const execution = meta.execution;
  const audit = meta.auditResult;
  const commands = meta.commands?.length ?? 0;
  const construction = !!audit || commands > 0 || !!execution?.steps.some(step =>
    CONSTRUCTION_TOOLS.has(toolBaseName(step.name)));
  if (!construction) return null;
  // Only the explicitly supplied object audit supports these limited claims.
  const issues = [...(audit?.missing ?? []), ...(audit?.undefinedObjs ?? [])];
  const check = !audit ? '未检查' : issues.length ? `发现 ${issues.length} 个对象问题`
    : audit.degraded ? '检查不完整' : '未发现对象缺失或数值异常';
  return { commands, category: meta.categoryLabel, issues, check,
    degraded: !!audit?.degraded, warning: issues.length > 0 || !!audit?.degraded,
    checked: !!audit };
}
