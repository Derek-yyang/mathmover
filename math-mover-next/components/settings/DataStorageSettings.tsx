'use client';

import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { libraryRequest } from '@/lib/courseware-client';
import { useAgentRuntimeState } from '../dashboard/AgentRuntimeState';

const actionButton = 'inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';

export default function DataStorageSettings({ active }: { active: boolean }) {
  const { busy } = useAgentRuntimeState();
  const [directory, setDirectory] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false);
  const [backupResult, setBackupResult] = useState('');
  const [backupError, setBackupError] = useState('');
  const backupPending = useRef(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void libraryRequest<{ dataDirectory: string }>().then(data => {
      if (cancelled) return;
      setDirectory(data.dataDirectory);
      setDirectoryError('');
    }).catch(error => {
      if (!cancelled) setDirectoryError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [active, retry]);

  const backup = async () => {
    if (busy || backupPending.current) return;
    backupPending.current = true;
    setWorking(true);
    setBackupResult('');
    setBackupError('');
    try {
      const result = await libraryRequest<{ name: string }>('/backup', {});
      setBackupResult(`备份完成，位于数据目录的 backups/${result.name}`);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      backupPending.current = false;
      setWorking(false);
    }
  };

  return <section aria-labelledby="data-storage-title">
    <h3 id="data-storage-title" className="text-base font-semibold text-stone-800">数据与存储</h3>
    <p className="mt-1 text-sm leading-6 text-stone-600">课件、对话和画板快照由本机服务保存。</p>
    <div className="mt-6">
      <h4 className="text-sm font-medium text-stone-800">数据目录</h4>
      {directoryError ? <div className="mt-2">
        <p role="alert" className="break-words text-sm leading-6 text-red-700">{directoryError}</p>
        <button type="button" className={actionButton + ' mt-2'} onClick={() => {
          setDirectoryError('');
          setRetry(value => value + 1);
        }}>重新读取</button>
      </div> : <p role="status" className="mt-2 break-all rounded-lg bg-stone-100 px-3 py-2.5 text-sm leading-6 text-stone-700">{directory || '正在读取…'}</p>}
    </div>
    <div className="mt-6 border-t border-stone-200 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-stone-800">备份课件库</h4>
          <p className="mt-1 text-sm leading-6 text-stone-600">在数据目录的 backups 文件夹中创建备份。</p>
        </div>
        <button type="button" className={actionButton} disabled={busy || working} onClick={() => void backup()}>
          <Download aria-hidden="true" className="h-4 w-4" />{working ? '正在备份…' : '创建备份'}
        </button>
      </div>
      {backupResult && <p role="status" className="mt-3 break-all text-sm leading-6 text-emerald-800">{backupResult}</p>}
      {backupError && <p role="alert" className="mt-3 break-words text-sm leading-6 text-red-700">{backupError}</p>}
    </div>
  </section>;
}
