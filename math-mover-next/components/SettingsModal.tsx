'use client';

/**
 * 设置壳（2026-10-13 评审后二次重构）：**左侧分区导航**——设置域会持续增长
 * （OpenDesign 型的可扩展性），导航即目录；「模型与提供商」域内保留本机 Agent /
 * 模型 API 双 Tab（装机与填密钥是两种心智）。弹窗壳保留：设置是打断而非
 * 目的地，画布才是核心（PRODUCT.md）。全局动作（刷新检测）在头部。
 */

import { useCallback, useRef, useState } from 'react';
import { Popover } from 'radix-ui';
import { RefreshCw, X } from 'lucide-react';
import AgentSettings from './settings/AgentSettings';
import ByokSettings, { type SettingsDraftState } from './settings/ByokSettings';
import HelpSettings from './settings/HelpSettings';
import AboutSettings from './settings/AboutSettings';
import ArchivedCoursewares from './settings/ArchivedCoursewares';
import DataStorageSettings from './settings/DataStorageSettings';
import AppearanceSettings from './settings/AppearanceSettings';
import { useAgentRuntimeState } from './dashboard/AgentRuntimeState';
import { SettingsSections, SettingsProviderTabs, type SettingsSection, type SettingsProviderTab } from './settings/SettingsLayout';
import { SettingsButton } from './settings/SettingsControls';
import { Dialog, DialogClose, DialogContent, DialogTitle } from './assistant-ui/ui/dialog';

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
  const [section, setSection] = useState<SettingsSection>('agents');
  const [tab, setTab] = useState<SettingsProviderTab>('providers');
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
      <SettingsSections section={section} onSectionChange={setSection}>
          {/* Keep configuration mounted across sections so drafts and test results survive. */}
          <div hidden={section !== 'agents'}>
            <SettingsProviderTabs tab={tab} onTabChange={setTab} cliCount={cliCount}
              api={<ByokSettings onDraftStateChange={handleDraftState} />} agents={<AgentSettings />} />
          </div>
          {section === 'archives' && <ArchivedCoursewares onOpen={onClose} onOpenRequest={requestClose} />}
          {section === 'appearance' && <AppearanceSettings />}
          <div hidden={section !== 'storage'}><DataStorageSettings active={section === 'storage'} /></div>
          {section === 'help' && <HelpSettings />}
          {section === 'about' && <AboutSettings />}
      </SettingsSections>
    </div>
    </DialogContent>
  </Dialog>;
}
