import type { AgentMeta } from '@/components/dashboard/types';
import type { AgentExecution } from './agent-progress';
import { toolStepLabel } from './agent-progress';

/** Presentation only: returned tools are not evidence of a valid construction. */
export function executionPresentation(execution: AgentExecution) {
  const errors = execution.steps.filter(step => step.status === 'error').length;
  const unconfirmed = execution.steps.filter(step => step.status === 'unconfirmed').length;
  const current = execution.steps.findLast(step => step.status === 'running');
  const running = execution.status === 'running';
  const warning = execution.status === 'error' || errors > 0;
  const uncertain = execution.status === 'unconfirmed' || unconfirmed > 0;
  const label = running ? current ? `正在${toolStepLabel(current.name)}` : '等待 Agent 回复'
    : execution.status === 'stopped' ? '已停止 · 本轮未跑完'
    : execution.status === 'error' ? '本轮中断'
    : warning ? '本轮结束 · 有工具返回错误'
    : uncertain ? '本轮结束 · 有结果未确认' : '本轮已结束';
  return { running, warning, uncertain, label, errors, unconfirmed };
}

export function runResultPresentation(meta?: AgentMeta) {
  if (!meta || meta.status === 'generating' || meta.status === 'classifying' || meta.execution?.status === 'running') return null;
  const execution = meta.execution;
  const audit = meta.auditResult;
  const commands = meta.commands?.length ?? 0;
  const construction = !!audit || commands > 0 || !!execution?.steps.some(step =>
    ['更新构造', '清空画板', '提交构造并检查'].includes(toolStepLabel(step.name)));
  if (!construction) return null;
  // Only the explicitly supplied object audit supports these limited claims.
  const issues = [...(audit?.missing ?? []), ...(audit?.undefinedObjs ?? [])];
  const check = !audit ? '未检查' : issues.length ? `发现 ${issues.length} 个对象问题`
    : audit.degraded ? '检查不完整' : '未发现对象缺失或数值异常';
  return { commands, category: meta.categoryLabel, issues, check,
    degraded: !!audit?.degraded, warning: issues.length > 0 || !!audit?.degraded,
    checked: !!audit };
}
