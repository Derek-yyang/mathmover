'use client';

/**
 * 设置壳（2026-10-13 评审后二次重构）：**左侧分区导航**——设置域会持续增长
 * （OpenDesign 型的可扩展性），导航即目录；「模型与提供商」域内保留本机 CLI /
 * API 提供商双 Tab（装机与填密钥是两种心智）。弹窗壳保留：设置是打断而非
 * 目的地，画布才是核心（PRODUCT.md）。全局动作（刷新检测）在头部。
 */

import { useEffect, useRef, useState } from 'react';
import { Info, Keyboard, Cpu, RefreshCw, X } from 'lucide-react';
import AgentSettings from './settings/AgentSettings';
import ByokSettings from './settings/ByokSettings';
import HelpSettings from './settings/HelpSettings';
import AboutSettings from './settings/AboutSettings';
import { useAgentRuntimeState } from './dashboard/AgentRuntimeState';

const quietButton = 'rounded-lg px-3 py-2 text-sm font-medium hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed';
const tabButton = (active: boolean) =>
  `relative -mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
    active ? 'border-emerald-700 text-emerald-900' : 'border-transparent text-stone-600 hover:text-stone-900'}`;
const navButton = (active: boolean) =>
  `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
    active ? 'bg-emerald-50 text-emerald-900' : 'text-stone-700 hover:bg-stone-100'}`;

type Section = 'agents' | 'help' | 'about';

const NAV: Array<{ id: Section; label: string; icon: typeof Cpu }> = [
  { id: 'agents', label: '模型与提供商', icon: Cpu },
  { id: 'help', label: '帮助与快捷键', icon: Keyboard },
  { id: 'about', label: '关于', icon: Info },
];

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<Section>('agents');
  const [tab, setTab] = useState<'cli' | 'providers'>('cli');
  const tabRefs = useRef<Record<'cli' | 'providers', HTMLButtonElement | null>>({ cli: null, providers: null });
  const { runtimes, detecting, refreshRuntimes } = useAgentRuntimeState();
  const cliCount = runtimes.filter(item => item.id !== 'byok' && item.usable).length;

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); trigger?.focus(); };
  }, []);

  // 标准 tablist 键盘：方向键移动并切换（焦点跟随选中项），Home/End 跳两端
  const onTabKeyDown = (event: React.KeyboardEvent) => {
    const order: Array<'cli' | 'providers'> = ['cli', 'providers'];
    const index = order.indexOf(tab);
    let next: 'cli' | 'providers' | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      next = order[(index + (event.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length]!;
    } else if (event.key === 'Home') next = 'cli';
    else if (event.key === 'End') next = 'providers';
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return <dialog ref={dialogRef} aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }} className="m-auto h-[640px] max-h-[90dvh] w-[840px] max-w-[calc(100%-32px)] overflow-hidden rounded-2xl bg-[#FDFCF8] p-0 text-stone-800 shadow-2xl backdrop:bg-stone-900/40">
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-6 py-4">
        <h2 id="settings-title" className="text-lg font-semibold">设置</h2>
        <div className="flex items-center gap-1">
          <button type="button" className={quietButton + ' flex items-center gap-2 text-stone-700'}
            onClick={() => void refreshRuntimes()} disabled={detecting} aria-label="刷新检测">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />{detecting ? '正在检测…' : '刷新检测'}
          </button>
          <button type="button" aria-label="关闭设置" onClick={onClose} className={quietButton}><X className="h-5 w-5" /></button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="设置分区" className="w-48 shrink-0 border-r border-stone-200 px-3 py-4">
          <ul className="space-y-1">
            {NAV.map(item => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <li key={item.id}>
                  <button type="button" aria-current={active ? 'page' : undefined}
                    className={navButton(active)}
                    onClick={() => setSection(item.id)}>
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {section === 'agents' && (
            <>
              <div role="tablist" aria-label="模型与提供商" onKeyDown={onTabKeyDown}
                className="-mx-1 mb-4 flex gap-2 border-b border-stone-200 px-1">
                <button type="button" role="tab" id="settings-tab-cli" aria-controls="settings-panel-cli"
                  aria-selected={tab === 'cli'} tabIndex={tab === 'cli' ? 0 : -1}
                  ref={element => { tabRefs.current.cli = element; }}
                  className={tabButton(tab === 'cli')} onClick={() => setTab('cli')}>
                  本机 CLI{cliCount > 0 ? `（${cliCount}）` : ''}
                </button>
                <button type="button" role="tab" id="settings-tab-providers" aria-controls="settings-panel-providers"
                  aria-selected={tab === 'providers'} tabIndex={tab === 'providers' ? 0 : -1}
                  ref={element => { tabRefs.current.providers = element; }}
                  className={tabButton(tab === 'providers')} onClick={() => setTab('providers')}>
                  API 提供商
                </button>
              </div>
              {/* 两个面板保持挂载（hidden 切换）：表单草稿与测试结果不因切 Tab 蒸发 */}
              <div role="tabpanel" id="settings-panel-cli" aria-labelledby="settings-tab-cli" hidden={tab !== 'cli'}>
                <AgentSettings />
              </div>
              <div role="tabpanel" id="settings-panel-providers" aria-labelledby="settings-tab-providers" hidden={tab !== 'providers'}>
                <ByokSettings />
              </div>
            </>
          )}
          {section === 'help' && <HelpSettings />}
          {section === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  </dialog>;
}
