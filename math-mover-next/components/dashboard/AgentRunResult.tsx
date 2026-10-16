'use client';

import { ToolGroupRoot, ToolGroupTrigger, ToolGroupContent } from '@/components/assistant-ui/elements/tool-group.aui';
import type { AgentMeta, AuditFinding } from './types';
import { runResultPresentation } from '@/lib/agent-run-presentation';

function Finding({ finding }: { finding: AuditFinding }) {
  return <li className="break-words leading-6 [overflow-wrap:anywhere]">
    <span className="font-medium">{finding.name}</span>
    <span>：{finding.kind === 'missing' ? '对象未建立' : '数值未定义'}</span>
  </li>;
}

export default function AgentRunResult({ meta }: { meta?: AgentMeta }) {
  const result = runResultPresentation(meta);
  if (!result?.warning) return null;
  return <ToolGroupRoot aria-label="本轮结果" data-agent-result variant="ghost" defaultOpen={result.warning}
    className={`mt-2 min-w-0 text-xs leading-6 ${result.warning ? 'text-[var(--mm-text-amber-900)]' : 'text-[var(--mm-text-stone-700)]'}`}>
    <ToolGroupTrigger count={result.commands} label={`图形检查 · ${result.check}`} />
    <ToolGroupContent>
    {result.category && <p>{result.category}</p>}
    {result.commands > 0 && <p className="mt-1">记录了 {result.commands} 条构造指令</p>}
    {!result.checked && <p>本轮没有对象检查数据。</p>}
    {result.degraded && <p>检查信息不完整，仍需查看画板确认。</p>}
    {result.issues.length > 0 && <ul className="mt-1" aria-label="图形检查问题">
      {result.issues.slice(0, 3).map((finding, index) => <Finding key={`${finding.kind}-${finding.name}-${index}`} finding={finding} />)}
    </ul>}
    {result.issues.length > 3 && <details className="mt-1">
      <summary className="min-h-9 cursor-pointer content-center rounded px-1 hover:bg-[var(--mm-bg-amber-100)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-amber-800)]">另外 {result.issues.length - 3} 个问题</summary>
      <ul aria-label="其他图形检查问题">{result.issues.slice(3).map((finding, index) => <Finding key={`${finding.kind}-${finding.name}-${index}`} finding={finding} />)}</ul>
    </details>}
    </ToolGroupContent>
  </ToolGroupRoot>;
}
