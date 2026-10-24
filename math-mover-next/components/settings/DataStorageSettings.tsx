'use client';

import { useEffect, useRef, useState } from 'react';
import { Archive, Check, Copy, FolderOpen, Loader2 } from 'lucide-react';
import { libraryRequest } from '@/lib/courseware-client';
import { desktopBridge } from '@/lib/desktop-bridge';
import { useAgentRuntimeState } from '../dashboard/AgentRuntimeState';
import { SettingsButton } from './SettingsControls';

export default function DataStorageSettings({ active }: { active: boolean }) {
  const { busy } = useAgentRuntimeState();
  const [directory, setDirectory] = useState('');
  const [directoryError, setDirectoryError] = useState('');
  const [retry, setRetry] = useState(0);
  const [working, setWorking] = useState(false);
  const [backupResult, setBackupResult] = useState<{ name: string; createdAt: string }>();
  const [backupError, setBackupError] = useState('');
  const [canOpenDirectory, setCanOpenDirectory] = useState(false);
  const [opening, setOpening] = useState<'data' | 'backups' | null>(null);
  const [copying, setCopying] = useState<'data' | 'backups' | null>(null);
  const [copied, setCopied] = useState<'data' | 'backups' | null>(null);
  const [actionError, setActionError] = useState('');
  const [manualCopyPath, setManualCopyPath] = useState('');
  const backupPending = useRef(false);
  const folderPending = useRef(false);
  const copyPending = useRef(false);

  useEffect(() => { setCanOpenDirectory(!!desktopBridge()?.openStorageDirectory); }, []);

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
    setBackupError('');
    setActionError('');
    setManualCopyPath('');
    try {
      const result = await libraryRequest<{ name: string }>('/backup', {});
      setBackupResult({ name: result.name, createdAt: new Date().toISOString() });
      setCopied(null);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      backupPending.current = false;
      setWorking(false);
    }
  };

  const openDirectory = async (target: 'data' | 'backups') => {
    const bridge = desktopBridge();
    if (!bridge?.openStorageDirectory || folderPending.current) return;
    folderPending.current = true;
    setOpening(target);
    setActionError('');
    setManualCopyPath('');
    try { await bridge.openStorageDirectory(target); }
    catch { setActionError('无法打开文件夹，请复制路径后手动打开。'); }
    finally { folderPending.current = false; setOpening(null); }
  };

  const copyDirectory = async (target: 'data' | 'backups') => {
    if (!directory || copyPending.current || (target === 'backups' && !backupResult)) return;
    const separator = directory.includes('\\') ? '\\' : '/';
    const value = target === 'data' ? directory
      : `${directory.replace(/[\\/]+$/, '')}${separator}backups${separator}${backupResult!.name}`;
    copyPending.current = true;
    setCopying(target);
    setCopied(null);
    setActionError('');
    setManualCopyPath('');
    try { await navigator.clipboard.writeText(value); setCopied(target); }
    catch { setActionError('复制失败，请选中下方路径手动复制。'); setManualCopyPath(value); }
    finally { copyPending.current = false; setCopying(null); }
  };

  return <section aria-labelledby="data-storage-title">
    <h3 id="data-storage-title" className="text-base font-semibold text-[var(--mm-text-stone-800)]">数据与存储</h3>
    <p className="mt-1 text-sm leading-6 text-[var(--mm-text-stone-600)]">课件、对话和画板快照保存在本机。</p>
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-medium text-[var(--mm-text-stone-800)]">数据目录</h4>
        <div className="flex flex-wrap items-center gap-1">
          <SettingsButton type="button" disabled={!directory || !!directoryError || !!copying}
            onClick={() => void copyDirectory('data')} aria-busy={copying === 'data'}>
            {copied === 'data' ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
            {copied === 'data' ? '已复制' : '复制路径'}
          </SettingsButton>
          {canOpenDirectory && <SettingsButton type="button" disabled={!directory || !!directoryError || !!opening}
            onClick={() => void openDirectory('data')} aria-busy={opening === 'data'}>
            <FolderOpen aria-hidden className="h-4 w-4" />打开文件夹
          </SettingsButton>}
        </div>
      </div>
      {directoryError ? <div className="mt-2">
        <p role="alert" className="break-words text-sm leading-6 text-[var(--mm-text-red-700)]">{directoryError}</p>
        <SettingsButton type="button" variant="outline" className="mt-2" onClick={() => {
          setDirectoryError('');
          setRetry(value => value + 1);
        }}>重新读取</SettingsButton>
      </div> : <p role="status" className="mt-2 select-all break-all rounded-lg bg-[var(--mm-bg-stone-100)] px-3 py-2.5 font-mono text-xs leading-6 text-[var(--mm-text-stone-700)]">{directory || '正在读取…'}</p>}
    </div>
    <div className="mt-6 border-t border-[var(--mm-border-stone-200)] pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-[var(--mm-text-stone-800)]">备份课件库</h4>
          <p className="mt-1 text-sm leading-6 text-[var(--mm-text-stone-600)]">备份课件、对话和画板快照，不包含 API 密钥。</p>
        </div>
        <SettingsButton type="button" variant="outline" disabled={busy || working} aria-busy={working} onClick={() => void backup()}>
          {working ? <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Archive aria-hidden className="h-4 w-4" />}
          {working ? '正在备份…' : '创建备份'}
        </SettingsButton>
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--mm-text-stone-600)]">备份保存在数据目录的 backups 文件夹，重要备份建议另存到其他位置。</p>
      {backupResult && !working && <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div role="status">
          <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--mm-text-emerald-800)]"><Check aria-hidden className="h-4 w-4" />{backupError ? '上次成功备份' : '备份已创建'}</p>
          <time dateTime={backupResult.createdAt} className="mt-1 block text-xs leading-5 text-[var(--mm-text-stone-600)]">
            {new Date(backupResult.createdAt).toLocaleString()}
          </time>
        </div>
        {canOpenDirectory ? <SettingsButton type="button" disabled={!!opening}
          aria-busy={opening === 'backups'} onClick={() => void openDirectory('backups')}>
          <FolderOpen aria-hidden className="h-4 w-4" />打开备份文件夹
        </SettingsButton> : <SettingsButton type="button" disabled={!directory || !!copying}
          aria-busy={copying === 'backups'} onClick={() => void copyDirectory('backups')}>
          {copied === 'backups' ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
          {copied === 'backups' ? '已复制备份路径' : '复制备份路径'}
        </SettingsButton>}
      </div>}
      {backupError && <p role="alert" className="mt-3 break-words text-sm leading-6 text-[var(--mm-text-red-700)]">{backupError}</p>}
    </div>
    {actionError && <p role="alert" className="mt-3 text-sm leading-6 text-[var(--mm-text-red-700)]">{actionError}</p>}
    {manualCopyPath && <code className="mt-2 block select-all break-all rounded-lg bg-[var(--mm-bg-stone-100)] px-3 py-2 font-mono text-xs leading-6 text-[var(--mm-text-stone-700)]">{manualCopyPath}</code>}
  </section>;
}
