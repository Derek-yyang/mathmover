'use client';

import { AlertTriangle, CircleHelp, ScanLine } from 'lucide-react';
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
  if (!result) return null;
  const Icon = result.warning ? AlertTriangle : result.checked ? ScanLine : CircleHelp;
  return <section aria-label="本轮结果" role="status" data-agent-result
    className={`mt-3 min-w-0 rounded-lg p-3 text-xs leading-6 ${result.warning ? 'bg-amber-50 text-amber-900' : 'bg-stone-100 text-stone-700'}`}>
    <div className="flex items-center gap-2"><Icon aria-hidden className="h-4 w-4 shrink-0" />
      <span className="font-medium">本轮结果</span>
      {result.category && <span className="ml-auto min-w-0 break-words">{result.category}</span>}
    </div>
    {result.commands > 0 && <p className="mt-1">记录了 {result.commands} 条构造指令</p>}
    <p className="mt-1">图形检查 · {result.check}</p>
    {!result.checked && <p>本轮没有对象检查数据。</p>}
    {result.degraded && <p>检查信息不完整，仍需查看画板确认。</p>}
    {result.issues.length > 0 && <ul className="mt-1" aria-label="图形检查问题">
      {result.issues.slice(0, 3).map((finding, index) => <Finding key={`${finding.kind}-${finding.name}-${index}`} finding={finding} />)}
    </ul>}
    {result.issues.length > 3 && <details className="mt-1">
      <summary className="min-h-9 cursor-pointer content-center rounded px-1 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-amber-800">另外 {result.issues.length - 3} 个问题</summary>
      <ul aria-label="其他图形检查问题">{result.issues.slice(3).map((finding, index) => <Finding key={`${finding.kind}-${finding.name}-${index}`} finding={finding} />)}</ul>
    </details>}
  </section>;
}
