'use client';

import { memo, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArchiveRestore, Check, Download, KeyRound, Loader2, RefreshCw, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../assistant-ui/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../assistant-ui/ui/select';
import { SettingsSections, SettingsProviderTabs, type SettingsSection, type SettingsProviderTab } from '../settings/SettingsLayout';
import { SettingsButton, SettingsStatusBadge } from '../settings/SettingsControls';
import { BrandIcon } from '../settings/BrandIcon';
import { ByokModelField, type ModelListState } from '../settings/ByokModelField';
import { AppearanceSettingsView } from '../settings/AppearanceSettings';
import HelpSettings from '../settings/HelpSettings';
import AboutSettings from '../settings/AboutSettings';
import { API_FORMATS, isApiFormat, type ApiFormat } from '../../../packages/agent-runtime/src/api-format';
import styles from '@/app/landing.module.css';

const inputClass = 'mt-1 w-full rounded-lg border border-[var(--mm-border-stone-300)] bg-[var(--mm-surface)] px-2.5 py-1.5 text-sm text-[var(--mm-text-stone-800)]';
const initialConfig = { apiFormat: 'openai-chat' as ApiFormat, baseUrl: 'https://api.example.com/v1', model: 'demo-chat', reasoningLevels: ['low', 'medium', 'high'] };
const demoAgents = [
  { id: 'claude-code', name: 'Claude Code', source: 'Anthropic 官方 CLI', models: ['Sonnet', 'Opus'] },
  { id: 'codex', name: 'Codex', source: 'OpenAI 官方 CLI', models: ['GPT', 'GPT Codex'] },
  { id: 'dsh', name: 'DeepSeek Harness', source: 'DeepSeek 官方 CLI', models: ['DeepSeek Chat', 'DeepSeek Reasoner'] },
];

function DemoSelect({ label, value, values, onChange, panel }: {
  label: string; value: string; values: readonly string[]; onChange: (value: string) => void; panel: HTMLDivElement | null;
}) {
  const id = useId();
  return <div className="min-w-0 flex-1 text-xs font-medium text-[var(--mm-text-stone-600)]">
    <label htmlFor={id}>{label}</label>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label} size="sm" className={`${inputClass} flex`}><SelectValue /></SelectTrigger>
      <SelectContent portalContainer={panel} position="popper" align="start" collisionBoundary={panel} collisionPadding={12}>
        {values.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>;
}

// Deliberately no runtime provider, fetch, filesystem bridge or persistent storage.
// Real Settings owns those effects; this host only supplies in-memory examples.
export default memo(function DemoSettings({ open, container, onClose }: {
  open: boolean; container: HTMLDivElement | null; onClose: () => void;
}) {
  const id = useId();
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [section, setSection] = useState<SettingsSection>('agents');
  const [tab, setTab] = useState<SettingsProviderTab>('providers');
  const [selected, setSelected] = useState('byok');
  const [config, setConfig] = useState(initialConfig);
  const [savedConfig, setSavedConfig] = useState(initialConfig);
  const [apiKey, setApiKey] = useState('');
  const [modelList, setModelList] = useState<ModelListState>({ loading: false });
  const [modelsOpen, setModelsOpen] = useState(false);
  const [models, setModels] = useState<Record<string, string>>({});
  const [efforts, setEfforts] = useState<Record<string, string>>({});
  const [theme, setTheme] = useState('system');
  const [archived, setArchived] = useState(true);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const confirmWasOpen = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = JSON.stringify(config) !== JSON.stringify(savedConfig) || apiKey !== '';

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (confirmClose) {
      confirmWasOpen.current = true;
      continueRef.current?.focus();
    } else if (confirmWasOpen.current) {
      confirmWasOpen.current = false;
      closeRef.current?.focus();
    }
  }, [confirmClose]);
  const simulate = (action: string, complete: () => void) => {
    if (timer.current) return;
    setPending(action); setNotice('');
    timer.current = setTimeout(() => { timer.current = null; setPending(''); complete(); }, 500);
  };
  const close = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPending(''); setModelList(previous => ({ ...previous, loading: false }));
    setConfirmClose(false); setApiKey(''); onClose();
  };
  const requestClose = () => { if (dirty) setConfirmClose(true); else close(); };
  const keepFocusInDialog = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || confirmClose || !panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), summary, [role="tab"]:not([aria-disabled="true"]), [role="menuitem"]:not([data-disabled])',
    )).filter(element => !element.closest('[hidden], [inert]') && element.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  const updateConfig = (patch: Partial<typeof config>) => { setConfig(previous => ({ ...previous, ...patch })); setNotice(''); };
  const save = () => {
    try {
      const url = new URL(config.baseUrl);
      if (!['https:', 'http:'].includes(url.protocol) || !config.model.trim()) throw new Error();
      setSavedConfig(config); setApiKey(''); setNotice('已保存示例配置，仅在本次演示中生效。');
    } catch { setNotice('请填写有效的 HTTP / HTTPS 端点和模型 ID。'); }
  };
  const selectRuntime = (runtime: string) => { setSelected(runtime); setNotice('已切换演示 Agent。'); };

  const api = <div className={`rounded-xl border ${selected === 'byok' ? 'border-[var(--mm-border-emerald-700)]/40 bg-[var(--mm-bg-emerald-50)]/50' : 'border-[var(--mm-border-stone-200)] bg-[var(--mm-surface)]'}`}>
    <div className="flex flex-wrap items-start gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--mm-bg-stone-100)]"><KeyRound size={18} aria-hidden="true" /></span>
      <div className="min-w-0 flex-1"><h3 className="text-base font-semibold">内置 Agent</h3><div className="mt-1"><SettingsStatusBadge tone="success">示例配置</SettingsStatusBadge></div></div>
      <div className="flex items-center gap-1">
        <SettingsButton aria-label="测试 内置 Agent" disabled={!!pending || dirty} title={dirty ? '请先保存示例配置' : '模拟连接测试'} onClick={() => simulate('test-byok', () => setNotice('演示测试完成。桌面端会检测你配置的真实接口。'))}>
          {pending === 'test-byok' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}测试
        </SettingsButton>
        {selected === 'byok' ? <span className={styles.demoCurrent}><Check size={14} aria-hidden="true" />当前使用</span> : <SettingsButton onClick={() => selectRuntime('byok')}>使用</SettingsButton>}
      </div>
    </div>
    <div className="border-t border-[var(--mm-border-stone-200)] px-4 pb-4 pt-3">
      <fieldset disabled={!!pending} className="min-w-0 space-y-3">
        <div className="text-xs font-medium text-[var(--mm-text-stone-600)]">
          <label htmlFor={`${id}-format`}>接口格式</label>
          <Select value={config.apiFormat} disabled={!!pending} onValueChange={value => {
            if (isApiFormat(value)) { updateConfig({ apiFormat: value }); setModelList({ loading: false }); setModelsOpen(false); }
          }}>
            <SelectTrigger id={`${id}-format`} size="sm" aria-label="接口格式" className={`${inputClass} flex`}><SelectValue /></SelectTrigger>
            <SelectContent portalContainer={panel} position="popper" align="start" collisionBoundary={panel} collisionPadding={12}>
              {API_FORMATS.map(format => <SelectItem key={format.id} value={format.id}>{format.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className={styles.demoField}>API 端点<input className={inputClass} type="url" value={config.baseUrl} onChange={event => { updateConfig({ baseUrl: event.target.value }); setModelList({ loading: false }); }} /></label>
        <div className={styles.demoFieldRow}>
          <label className={styles.demoField}>API 密钥<input className={inputClass} type="password" autoComplete="off" placeholder="示例演示，无需填写真实密钥" value={apiKey} onChange={event => { setApiKey(event.target.value); setNotice(''); }} /></label>
          <ByokModelField value={config.model} onChange={model => updateConfig({ model })} disabled={!!pending} canFetch={!!config.baseUrl.trim()} list={modelList}
            onFetch={() => { setModelList({ loading: true }); simulate('models', () => { setModelList({ loading: false, models: [{ id: 'demo-chat', label: '示例对话模型' }, { id: 'demo-reasoning', label: '示例推理模型' }] }); setModelsOpen(true); }); }}
            open={modelsOpen} onOpenChange={setModelsOpen} portalContainer={panel} inputClassName={inputClass} />
        </div>
        {config.apiFormat.startsWith('openai-') ? <div className={styles.demoField}>
          <span id={`${id}-efforts`}>推理档位</span>
          <div role="group" aria-labelledby={`${id}-efforts`} className="mt-1 flex flex-wrap gap-1.5">
            {['low', 'medium', 'high'].map(level => <button key={level} type="button" role="switch" aria-label={`档位 ${level}`} aria-checked={config.reasoningLevels.includes(level)}
              className={`rounded-md border px-2 py-0.5 text-xs ${config.reasoningLevels.includes(level) ? 'border-[var(--mm-border-emerald-700)] bg-[var(--mm-bg-emerald-50)] text-[var(--mm-text-emerald-800)]' : 'border-[var(--mm-border-stone-300)]'}`}
              onClick={() => updateConfig({ reasoningLevels: config.reasoningLevels.includes(level) ? config.reasoningLevels.filter(item => item !== level) : [...config.reasoningLevels, level] })}>{level}</button>)}
          </div>
        </div> : <p className={styles.demoMuted}>此接口格式的推理参数由模型服务决定。</p>}
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-3"><SettingsButton variant="default" disabled={!!pending || !dirty} onClick={save}>保存</SettingsButton>{dirty && <span className="text-xs text-[var(--mm-text-stone-600)]">配置已修改，请先保存再测试。</span>}</div>
    </div>
  </div>;

  const agents = <div>
    <p className={styles.demoMuted}>选择本机的第三方 Agent 来生成课件。模型、账号和密钥由对应 Agent 管理。</p>
    <ul className="mt-4 space-y-3">
      {demoAgents.map(agent => <li key={agent.id} className={`rounded-xl border ${selected === agent.id ? 'border-[var(--mm-border-emerald-700)]/40 bg-[var(--mm-bg-emerald-50)]/50' : 'border-[var(--mm-border-stone-200)] bg-[var(--mm-surface)]'}`}>
        <div className="flex flex-wrap items-start gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--mm-bg-stone-100)]"><BrandIcon id={agent.id} /></span>
          <div className="min-w-0 flex-1"><h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">{agent.name}<SettingsStatusBadge tone="success">已登录 · 示例</SettingsStatusBadge></h3><p className="mt-1 text-xs text-[var(--mm-text-stone-600)]">{agent.source}</p></div>
          <div className="flex items-center gap-1"><SettingsButton disabled={!!pending} aria-label={`测试 ${agent.name}`} onClick={() => simulate(`test-${agent.id}`, () => setNotice(`${agent.name} 演示测试完成，未调用本机程序。`))}>{pending === `test-${agent.id}` && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}测试</SettingsButton>
            {selected === agent.id ? <span className={styles.demoCurrent}><Check size={14} aria-hidden="true" />当前使用</span> : <SettingsButton aria-label={`使用 ${agent.name}`} onClick={() => selectRuntime(agent.id)}>使用</SettingsButton>}</div>
        </div>
        {selected === agent.id && <div className="flex flex-wrap gap-4 border-t border-[var(--mm-border-stone-200)] px-4 pb-4 pt-3">
          <DemoSelect label="模型" value={models[agent.id] ?? agent.models[0]} values={agent.models} onChange={value => setModels(previous => ({ ...previous, [agent.id]: value }))} panel={panel} />
          <DemoSelect label="推理档位" value={efforts[agent.id] ?? 'medium'} values={['low', 'medium', 'high']} onChange={value => setEfforts(previous => ({ ...previous, [agent.id]: value }))} panel={panel} />
        </div>}
      </li>)}
    </ul>
  </div>;

  return <Dialog modal={false} open={open} onOpenChange={next => { if (!next) requestClose(); }}>
    <DialogContent ref={setPanel} portalContainer={container} data-slot="settings-dialog" data-demo-settings
      className={styles.demoSettingsDialog} overlayClassName={styles.demoSettingsOverlay} showCloseButton={false}
      aria-describedby={`${id}-description`}
      onKeyDown={keepFocusInDialog}
      onOpenAutoFocus={event => { event.preventDefault(); triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; closeRef.current?.focus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); triggerRef.current?.focus({ preventScroll: true }); }}
      onEscapeKeyDown={event => { if (confirmClose) { event.preventDefault(); setConfirmClose(false); } }}>
      <div className="flex h-full min-h-0 flex-col" inert={confirmClose}>
        <header className={styles.demoSettingsHeader}>
          <div className="flex items-center gap-2"><DialogTitle className="text-lg font-semibold leading-normal tracking-normal">设置</DialogTitle><SettingsStatusBadge>交互演示</SettingsStatusBadge></div>
          <div className="flex items-center gap-1">
            {section === 'agents' && <SettingsButton disabled={!!pending} aria-label="刷新检测" onClick={() => simulate('detect', () => setNotice('演示检测完成：3 个本机 Agent。'))}><RefreshCw size={14} className={pending === 'detect' ? 'animate-spin' : undefined} aria-hidden="true" />{pending === 'detect' ? '正在检测…' : '刷新检测'}</SettingsButton>}
            <SettingsButton ref={closeRef} size="icon" className="size-8" aria-label="关闭演示设置" onClick={requestClose}><X size={16} aria-hidden="true" /></SettingsButton>
          </div>
        </header>
        <SettingsSections section={section} onSectionChange={value => { setSection(value); setNotice(''); }}>
          <div hidden={section !== 'agents'}><SettingsProviderTabs tab={tab} onTabChange={value => { setTab(value); setNotice(''); }} cliCount={3} api={api} agents={agents} /></div>
          {section === 'appearance' && <><AppearanceSettingsView theme={theme} setTheme={setTheme} /><div className={styles.demoThemeSample} data-preview-theme={theme}><span>M</span><div><strong>MathMover</strong><p>主题效果预览</p></div></div><p className={styles.demoMuted}>此处仅预览外观选项，首页主题可通过导航栏切换。</p></>}
          {section === 'archives' && <><h3 className="text-base font-semibold">归档课件</h3><p className={styles.demoMuted}>保留对话和画板，可随时打开或取消归档。</p>{archived ? <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--mm-bg-stone-100)] p-3"><span className="text-sm">椭圆与动点（示例）</span><SettingsButton onClick={() => { setArchived(false); setNotice('示例课件已取消归档。'); }}><ArchiveRestore size={14} aria-hidden="true" />取消归档</SettingsButton></div> : <p className="py-8 text-sm text-[var(--mm-text-stone-600)]">暂无归档课件</p>}</>}
          {section === 'storage' && <><h3 className="text-base font-semibold">数据与存储</h3><p className={styles.demoMuted}>课件、对话和配置保存在桌面端的本机应用数据目录。</p><dl className="my-5 space-y-3 text-sm"><div><dt className="font-medium">数据目录</dt><dd className="mt-1 text-[var(--mm-text-stone-600)]">本机应用数据目录（示例）</dd></div><div><dt className="font-medium">课件备份</dt><dd className="mt-1 text-[var(--mm-text-stone-600)]">备份课件与对话，不包含 API 密钥。</dd></div></dl><SettingsButton variant="outline" disabled={!!pending} onClick={() => simulate('backup', () => setNotice('备份流程演示完成。桌面端会生成可下载的备份文件。'))}><Download size={14} aria-hidden="true" />导出备份</SettingsButton></>}
          {section === 'help' && <HelpSettings />}
          {section === 'about' && <AboutSettings />}
          {notice && <p role="status" className="mt-3 text-xs leading-5 text-[var(--mm-text-emerald-800)]">{notice}</p>}
        </SettingsSections>
        <p id={`${id}-description`} className={styles.demoSettingsNote}>示例数据，仅供体验。不会连接模型或保存到设备。</p>
      </div>
      {confirmClose && <div className={styles.demoDiscardOverlay}><section role="alertdialog" aria-modal="true" aria-labelledby={`${id}-discard`} aria-describedby={`${id}-discard-description`} className={styles.demoDiscard}>
        <h3 id={`${id}-discard`} className="text-sm font-semibold">放弃未保存的修改？</h3><p id={`${id}-discard-description`} className={styles.demoMuted}>关闭后，尚未保存的示例配置修改将丢失。</p>
        <div className="mt-3 flex justify-end gap-2"><SettingsButton ref={continueRef} onClick={() => setConfirmClose(false)}>继续编辑</SettingsButton><SettingsButton variant="destructive" onClick={() => { setConfig(savedConfig); close(); }}>放弃并关闭</SettingsButton></div>
      </section></div>}
    </DialogContent>
  </Dialog>;
});
