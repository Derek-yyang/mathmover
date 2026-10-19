'use client';

/**
 * 设置壳（2026-10-13 评审后二次重构）：**左侧分区导航**——设置域会持续增长
 * （OpenDesign 型的可扩展性），导航即目录；「模型与提供商」域内保留本机 Agent /
 * 模型 API 双 Tab（装机与填密钥是两种心智）。弹窗壳保留：设置是打断而非
 * 目的地，画布才是核心（PRODUCT.md）。全局动作（刷新检测）在头部。
 */

import { useCallback, useRef, useState } from 'react';
import { Popover } from 'radix-ui';
import { Archive, Database, Info, Keyboard, Cpu, RefreshCw, SunMoon, X } from 'lucide-react';
import AgentSettings from './settings/AgentSettings';
import ByokSettings, { type SettingsDraftState } from './settings/ByokSettings';
import HelpSettings from './settings/HelpSettings';
import AboutSettings from './settings/AboutSettings';
import ArchivedCoursewares from './settings/ArchivedCoursewares';
import DataStorageSettings from './settings/DataStorageSettings';
import AppearanceSettings from './settings/AppearanceSettings';
import { useAgentRuntimeState } from './dashboard/AgentRuntimeState';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './assistant-ui/ui/tabs';
import { SettingsButton } from './settings/SettingsControls';
import { Dialog, DialogClose, DialogContent, DialogTitle } from './assistant-ui/ui/dialog';

const settingsTab = 'h-10 flex-none rounded-none px-4 after:bg-primary data-[state=active]:text-primary dark:data-[state=active]:text-primary group-data-[orientation=horizontal]/tabs:after:bottom-[-1px]';
const navButton = (active: boolean) =>
  `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)] ${
    active ? 'bg-[var(--mm-bg-emerald-50)] text-[var(--mm-text-emerald-900)]' : 'text-[var(--mm-text-stone-700)] hover:bg-[var(--mm-bg-stone-100)]'}`;

type Section = 'agents' | 'appearance' | 'archives' | 'storage' | 'help' | 'about';

const NAV: Array<{ id: Section; label: string; icon: typeof Cpu }> = [
  { id: 'agents', label: '模型与提供商', icon: Cpu },
  { id: 'appearance', label: '外观', icon: SunMoon },
  { id: 'archives', label: '归档课件', icon: Archive },
  { id: 'storage', label: '数据与存储', icon: Database },
  { id: 'help', label: '帮助与快捷键', icon: Keyboard },
  { id: 'about', label: '关于', icon: Info },
];

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const cancelCloseRef = useRef<HTMLButtonElement | null>(null);
  const closeFocusRef = useRef<HTMLElement | null>(null);
  const pendingCloseRef = useRef(onClose);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<SettingsDraftState>({ dirty: false, saving: false });
  const [confirmClose, setConfirmClose] = useState(false);
  const handleDraftState = useCallback((state: SettingsDraftState) => {
    setDraft(previous => previous.dirty === state.dirty && previous.saving === state.saving ? previous : state);
    if (!state.dirty && !state.saving) setConfirmClose(false);
  }, []);
  const [section, setSection] = useState<Section>('agents');
  const [tab, setTab] = useState<'cli' | 'providers'>('providers');
  const { runtimes, detecting, refreshRuntimes } = useAgentRuntimeState();
  const cliCount = runtimes.filter(item => item.id !== 'byok' && item.usable).length;
  const requestClose = (proceed = onClose) => {
    if (!draft.dirty && !draft.saving) { proceed(); return; }
    closeFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pendingCloseRef.current = proceed;
    setConfirmClose(true);
  };

  return <Dialog open onOpenChange={open => { if (!open) requestClose(); }}>
    <DialogContent ref={setPanel} data-slot="settings-dialog" aria-labelledby="settings-title" aria-describedby={undefined}
      showCloseButton={false} overlayClassName="bg-[var(--mm-bg-stone-900)]/40"
      onOpenAutoFocus={() => { triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={event => { event.preventDefault(); if (triggerRef.current?.isConnected) triggerRef.current.focus(); }}
      className="block h-[640px] max-h-[90dvh] w-[840px] max-w-[calc(100%-32px)] overflow-hidden rounded-xl border-0 bg-[var(--mm-canvas-shell)] p-0 text-[var(--mm-text-stone-800)] shadow-2xl sm:rounded-xl">
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--mm-border-stone-200)] px-6 py-4">
        <DialogTitle id="settings-title" className="text-lg font-semibold leading-normal tracking-normal">设置</DialogTitle>
        <div className="flex items-center gap-1">
          {section === 'agents' && <SettingsButton type="button"
            onClick={() => void refreshRuntimes()} disabled={detecting} aria-busy={detecting} aria-label="刷新检测">
            <RefreshCw className={detecting ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden="true" />{detecting ? '正在检测…' : '刷新检测'}
          </SettingsButton>}
          <Popover.Root open={confirmClose} onOpenChange={setConfirmClose}>
            <Popover.Anchor asChild>
              <DialogClose asChild><SettingsButton type="button" size="icon" className="size-8" aria-label="关闭设置"><X aria-hidden="true" /></SettingsButton></DialogClose>
            </Popover.Anchor>
            <Popover.Portal container={panel}>
              <Popover.Content side="bottom" align="end" sideOffset={8} collisionBoundary={panel} collisionPadding={12}
                aria-labelledby="settings-discard-title" aria-describedby="settings-discard-description"
                className="z-50 w-72 max-w-[calc(100vw-48px)] rounded-xl border border-[var(--mm-border-stone-200)] bg-popover p-3 text-popover-foreground shadow-sm outline-none"
                onOpenAutoFocus={event => { event.preventDefault(); cancelCloseRef.current?.focus(); }}
                onCloseAutoFocus={event => { event.preventDefault(); if (closeFocusRef.current?.isConnected) closeFocusRef.current.focus(); }}>
                <h3 id="settings-discard-title" className="text-sm font-semibold">放弃未保存的修改？</h3>
                <p id="settings-discard-description" role="status" className="mt-1 text-xs leading-5 text-[var(--mm-text-stone-600)]">
                  {draft.saving ? '配置正在保存，请稍候。' : '关闭后，尚未保存的 API 配置修改将丢失。'}
                </p>
                <div className="mt-3 flex justify-end gap-1.5">
                  <Popover.Close ref={cancelCloseRef} asChild><SettingsButton>继续编辑</SettingsButton></Popover.Close>
                  <SettingsButton variant="destructive" disabled={draft.saving} onClick={() => pendingCloseRef.current()}>放弃并关闭</SettingsButton>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="设置分区" className="w-48 shrink-0 border-r border-[var(--mm-border-stone-200)] px-3 py-4">
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
        <div className="settings-scroll-viewport min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          {/* Keep configuration mounted across sections so drafts and test results survive. */}
          <div hidden={section !== 'agents'}>
            <Tabs value={tab} onValueChange={value => { if (value === 'cli' || value === 'providers') setTab(value); }} className="gap-0">
              <TabsList variant="line" aria-label="模型与提供商"
                className="mb-4 h-10 w-full justify-start border-b border-[var(--mm-border-stone-200)] p-0 group-data-[orientation=horizontal]/tabs:h-10">
                <TabsTrigger value="providers" id="settings-tab-providers" aria-controls="settings-panel-providers" className={settingsTab}>
                  模型 API
                </TabsTrigger>
                <TabsTrigger value="cli" id="settings-tab-cli" aria-controls="settings-panel-cli" className={settingsTab}>
                  本机 Agent{cliCount > 0 ? `（${cliCount}）` : ''}
                </TabsTrigger>
              </TabsList>
              {/* 两个面板保持挂载（hidden 切换）：表单草稿与测试结果不因切 Tab 蒸发 */}
              <TabsContent forceMount value="providers" id="settings-panel-providers" aria-labelledby="settings-tab-providers" hidden={tab !== 'providers'}>
                <ByokSettings onDraftStateChange={handleDraftState} />
              </TabsContent>
              <TabsContent forceMount value="cli" id="settings-panel-cli" aria-labelledby="settings-tab-cli" hidden={tab !== 'cli'}>
                <AgentSettings />
              </TabsContent>
            </Tabs>
          </div>
          {section === 'archives' && <ArchivedCoursewares onOpen={onClose} onOpenRequest={requestClose} />}
          {section === 'appearance' && <AppearanceSettings />}
          <div hidden={section !== 'storage'}><DataStorageSettings active={section === 'storage'} /></div>
          {section === 'help' && <HelpSettings />}
          {section === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
    </DialogContent>
  </Dialog>;
}
