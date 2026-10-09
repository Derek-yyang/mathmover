'use client';

import { AlertTriangle, ExternalLink } from 'lucide-react';
import type { AgentDiagnostic } from '@/lib/agent-diagnostics';
import { agentGuide } from '@/lib/agent-settings';

export default function AgentDiagnosticNotice({ diagnostic, onRescan, detecting = false, historical = false }: {
  diagnostic: AgentDiagnostic;
  onRescan: () => void;
  detecting?: boolean;
  historical?: boolean;
}) {
  const guide = diagnostic.runtimeId ? agentGuide(diagnostic.runtimeId) : undefined;
  return (
    <div className="min-w-0 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-stone-800" data-agent-diagnostic={diagnostic.kind}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-amber-800" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p role="alert" className="font-medium text-amber-900">{historical ? '上次调用：' : ''}{diagnostic.title}</p>
          <p className="mt-1 break-words text-stone-700">{diagnostic.guidance}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <button type="button" disabled={detecting} onClick={onRescan}
              className="rounded py-1 font-medium text-emerald-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:text-stone-600">
              {detecting ? '正在检测…' : '重新检测'}
            </button>
            {guide && <a href={guide.docsUrl} target="_blank" rel="noopener noreferrer"
              aria-label="查看配置指引（新窗口打开）"
              className="inline-flex items-center gap-1 rounded py-1 font-medium text-emerald-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
              查看配置指引<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>}
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer rounded text-xs text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">错误详情（已做常见凭据脱敏）</summary>
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded bg-white/70 p-2 font-mono text-xs leading-5 text-stone-700">{diagnostic.detail}</pre>
          </details>
        </div>
      </div>
    </div>
  );
}
