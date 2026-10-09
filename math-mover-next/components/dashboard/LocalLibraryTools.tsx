'use client';
import { useState } from 'react';
import { Database, RotateCcw, Download } from 'lucide-react';
import { historyChanged, libraryRequest, type CoursewareSummary } from '@/lib/courseware-client';

export default function LocalLibraryTools({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState(''); const [trash, setTrash] = useState<CoursewareSummary[]>([]);
  const [message, setMessage] = useState(''); const [working, setWorking] = useState(false);
  const run = async (job: () => Promise<void>) => {
    if (disabled || working) return; setWorking(true); setMessage('');
    try { await job(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setWorking(false); }
  };
  const refresh = async () => { const data = await libraryRequest<{ records: CoursewareSummary[]; dataDirectory: string }>('?trash=1'); setRoot(data.dataDirectory); setTrash(data.records); };
  return <div>
    <button type="button" aria-expanded={open} disabled={disabled} onClick={() => { setOpen(!open); if (!open) void run(refresh); }}
      className="flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-stone-800 hover:bg-stone-200/50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-emerald-700"><Database className="h-4 w-4 text-stone-600" />本地课件库</button>
    {open && <section aria-label="本地课件库管理" className="max-h-72 overflow-y-auto px-3 pb-3 text-xs leading-5 text-stone-700">
      <p className="break-all py-2">数据目录：{root || '正在读取…'}</p>
      <button type="button" disabled={working || disabled} onClick={() => void run(async () => { const result = await libraryRequest<{ name: string }>('/backup', {}); setMessage(`备份完成，位于数据目录的 backups/${result.name}`); })}
        className="flex items-center gap-2 rounded px-2 py-1 text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-emerald-700"><Download className="h-3 w-3" />{working ? '处理中…' : '备份课件库'}</button>
      <p className="mt-3 font-medium">回收站</p>
      {!trash.length && <p className="py-1">暂无已删除课件。</p>}
      {trash.map(item => <div key={item.id} className="flex items-center justify-between gap-2 py-1"><span className="truncate" title={item.title}>{item.title}</span>
        <button type="button" aria-label={`恢复课件：${item.title}`} disabled={working || disabled} onClick={() => void run(async () => { await libraryRequest(`/${item.id}/restore`, {}); historyChanged(); await refresh(); setMessage('课件已恢复。'); })}
          className="shrink-0 rounded p-1 text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-700"><RotateCcw className="h-4 w-4" /></button></div>)}
      {message && <p role="status" className="mt-2 break-all">{message}</p>}
    </section>}
  </div>;
}
