'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Route, X, Eye, EyeOff } from 'lucide-react';
import AgentSettings from './settings/AgentSettings';
import { readRoutingConfig, routingChanges, routingSavePayload, routingValidation, type RoutingConfig } from '@/lib/routing-settings';

type Section = 'agent' | 'routing';
type Feedback = { ok: boolean; text: string } | null;
const control = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 placeholder:text-stone-500 focus:outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20 disabled:bg-stone-100';
const quietButton = 'rounded-lg px-3 py-2 text-sm font-medium hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed';
const primaryButton = 'rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:bg-stone-200 disabled:text-stone-600 disabled:cursor-not-allowed';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>('agent');
  const [baseline, setBaseline] = useState<RoutingConfig | null>(null);
  const [draft, setDraft] = useState<RoutingConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [decisionsKey, setDecisionsKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [modelFeedback, setModelFeedback] = useState<Feedback>(null);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const requests = useRef(new Set<AbortController>());
  const loaded = useRef(false);
  const changes = routingChanges(baseline, draft, apiKey, decisionsKey);
  const dirty = Object.keys(changes).length > 0;
  const validation = draft ? routingValidation(draft, apiKey, decisionsKey) : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const pending = requests.current;
    return () => { pending.forEach(controller => controller.abort()); dialog?.close(); trigger?.focus(); };
  }, []);

  useEffect(() => { if (confirmClose) continueRef.current?.focus(); }, [confirmClose]);

  const requestJson = useCallback(async (url: string, options?: RequestInit) => {
    const controller = new AbortController();
    requests.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), options?.method === 'POST' && url === '/api/config' ? 120000 : 20000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      let data;
      try { data = await response.json(); }
      catch { throw new Error('配置服务未返回有效数据，请确认服务已启动。'); }
      if (!response.ok || data?.ok === false) throw new Error(typeof data?.error === 'string' ? data.error : '请求失败（' + response.status + '）');
      return data;
    } finally { clearTimeout(timeout); requests.current.delete(controller); }
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true); setLoadError(false);
    try {
      const cfg = readRoutingConfig(await requestJson('/api/config'));
      setBaseline(cfg); setDraft(cfg); loaded.current = true;
    } catch { setLoadError(true); }
    finally { setLoading(false); }
  }, [requestJson]);

  const chooseSection = (next: Section) => {
    if (next !== section && contentRef.current) contentRef.current.scrollTop = 0;
    setSection(next);
    if (next === 'routing' && !loaded.current && !loading && !loadError) void loadConfig();
  };
  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmClose(true); else onClose();
  };
  const update = (field: keyof RoutingConfig, value: string) => {
    setDraft(previous => previous ? { ...previous, [field]: value } : previous);
    setFeedback(null);
    if (field === 'base_url' || field === 'api_protocol') { setModelIds([]); setModelFeedback(null); }
  };

  const save = async () => {
    if (!draft || !baseline || loading || loadError || saving || !dirty || validation) return;
    setSaving(true); setFeedback(null);
    try {
      const result = await requestJson('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(routingSavePayload(baseline, draft, apiKey, decisionsKey)) });
      if (result?.ok !== true) throw new Error('配置服务未确认保存成功，请重新读取配置确认。');
      // 兼容旧端点的决策模型 ID 行为，不碰其他配置；不保留明文密钥。
      const saved = readRoutingConfig({ ...draft, ...changes, api_key_masked: apiKey.trim() ? '••••（已保存）' : draft.api_key_masked, perplexity_api_key_masked: decisionsKey.trim() ? '••••（已保存）' : draft.perplexity_api_key_masked });
      setBaseline(saved); setDraft(saved); setApiKey(''); setDecisionsKey('');
      setFeedback({ ok: true, text: '分类路由配置已保存。' });
    } catch (error) { setFeedback({ ok: false, text: error instanceof Error ? error.message : '保存失败，请重试。' }); }
    finally { setSaving(false); }
  };

  const fetchModels = async () => {
    if (!draft || fetchingModels) return;
    setFetchingModels(true); setModelFeedback(null);
    try {
      const data = await requestJson('/api/config/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base_url: draft.base_url.trim(), api_protocol: draft.api_protocol, ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) }) });
      if (!Array.isArray(data.models) || data.models.some((id: unknown) => typeof id !== 'string')) throw new Error('模型目录格式无效，可手动输入模型 ID。');
      setModelIds(data.models);
      setModelFeedback({ ok: Boolean(data.models.length), text: data.models.length ? '已获取 ' + data.models.length + ' 个模型，可从下方目录选择。' : '没有返回模型，可手动输入模型 ID。' });
    } catch (error) { setModelFeedback({ ok: false, text: error instanceof Error ? error.message : '获取失败，可手动输入模型 ID。' }); }
    finally { setFetchingModels(false); }
  };

  return <dialog ref={dialogRef} aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); requestClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose();
  }} className="settings-dialog m-auto h-[640px] max-h-[90dvh] w-[840px] max-w-[calc(100%-32px)] overflow-hidden rounded-2xl bg-[#FDFCF8] p-0 text-stone-800 shadow-2xl backdrop:bg-stone-900/40">
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-stone-200 px-6 py-4">
        <h2 id="settings-title" className="text-lg font-semibold">设置</h2>
        <button ref={closeRef} type="button" aria-label="关闭设置" onClick={requestClose} disabled={saving} className={quietButton}><X className="h-5 w-5" /></button>
      </header>
      {confirmClose ? <div role="alert" className="flex flex-1 flex-col justify-center px-6 sm:px-10">
        <h3 className="text-base font-semibold">有未保存的路由修改</h3><p className="mt-2 text-sm leading-6 text-stone-600">关闭后，这些修改将被放弃。已选 Agent 不受影响。</p>
        <div className="mt-6 flex flex-wrap gap-3"><button ref={continueRef} className={primaryButton} onClick={() => { setConfirmClose(false); closeRef.current?.focus(); }}>继续编辑</button><button className={quietButton} onClick={onClose}>放弃修改并关闭</button></div>
      </div> : <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav aria-label="设置分类" className="flex shrink-0 gap-1 border-b border-stone-200 bg-stone-50 p-3 sm:w-40 sm:flex-col sm:border-r sm:border-b-0">
          {([{ id: 'agent', label: 'Agent', icon: Bot }, { id: 'routing', label: '分类路由', icon: Route }] as const).map(item => <button key={item.id} type="button" aria-current={section === item.id ? 'page' : undefined} onClick={() => chooseSection(item.id)} className={quietButton + ' flex items-center gap-2 text-left' + (section === item.id ? ' bg-emerald-50 text-emerald-900' : '')}><item.icon className="h-4 w-4" />{item.label}</button>)}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {section === 'agent' ? <AgentSettings /> : <>
              <h3 className="text-base font-semibold text-stone-900">题目分类路由</h3>
              <p className="mt-2 mb-5 text-sm leading-6 text-stone-600">只用于题目分类，不改变第三方 Agent 的生成模型或账号配置。</p>
              {loading ? <div role="status" className="space-y-4 text-sm text-stone-600">正在读取路由配置…{[1, 2, 3].map(id => <div key={id} className="h-10 rounded-lg bg-stone-100" />)}</div> : loadError ? <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm leading-6 text-red-800"><p>无法读取路由配置，请确认本机配置服务已启动。Agent 页面仍可使用；读取成功前不会保存任何配置。</p><button type="button" className={quietButton + ' mt-2 text-red-800'} onClick={() => void loadConfig()}>重新读取</button></div> : draft ? <fieldset disabled={saving || fetchingModels} className="space-y-5">
                <div><label htmlFor="router-mode" className="mb-2 block text-sm font-medium">分类方式</label><select id="router-mode" value={draft.router_mode} onChange={event => update('router_mode', event.target.value)} className={control}><option value="llm">LLM 分类</option><option value="decisions">决策模型 + LLM 回退</option></select></div>
                {draft.router_mode === 'decisions' && <div className="space-y-4 rounded-lg bg-stone-100 p-4">
                  <div><label htmlFor="decisions-key" className="mb-2 block text-sm font-medium">Perplexity API 密钥</label><input id="decisions-key" autoComplete="off" type="password" value={decisionsKey} onChange={event => { setDecisionsKey(event.target.value); setFeedback(null); }} placeholder={draft.perplexity_api_key_masked ? '留空保留现有密钥' : '输入 Perplexity API 密钥'} className={control} />{draft.perplexity_api_key_masked && <p className="mt-1 text-xs text-stone-600">已有密钥：{draft.perplexity_api_key_masked}</p>}</div>
                  <div><label htmlFor="decisions-model" className="mb-2 block text-sm font-medium">决策模型 ID</label><input id="decisions-model" value={draft.decisions_model} onChange={event => update('decisions_model', event.target.value)} placeholder="pplx-decider-v1-27b" className={control} /></div>
                  <div><label htmlFor="decisions-threshold" className="mb-2 block text-sm font-medium">置信度阈值</label><input id="decisions-threshold" type="number" min="0.01" max="1" step="any" value={draft.decisions_threshold} onChange={event => update('decisions_threshold', event.target.value)} aria-describedby="threshold-hint" className={control} /><p id="threshold-hint" className="mt-2 text-xs leading-5 text-stone-600">大于 0 且不超过 1；低于阈值或调用失败时，回退到下方 LLM 模型。</p></div>
                  <p className="text-xs leading-5 text-stone-600">此模式保存时，配置服务会调用决策模型测试图片支持，可能产生服务费用。</p>
                </div>}
                <div className="border-t border-stone-200 pt-4"><h4 className="text-sm font-semibold">{draft.router_mode === 'decisions' ? 'LLM 回退分类模型' : 'LLM 分类模型'}</h4></div>
                <div><label htmlFor="routing-url" className="mb-2 block text-sm font-medium">API 地址</label><input id="routing-url" type="url" value={draft.base_url} onChange={event => update('base_url', event.target.value)} placeholder="https://api.example.com/v1" className={control} /></div>
                <div><label htmlFor="routing-protocol" className="mb-2 block text-sm font-medium">API 协议</label><select id="routing-protocol" value={draft.api_protocol} onChange={event => update('api_protocol', event.target.value)} className={control}><option value="openai_chat">OpenAI Chat Completions</option><option value="openai_responses">OpenAI Responses</option><option value="anthropic">Anthropic Messages</option></select></div>
                <div><label htmlFor="routing-key" className="mb-2 block text-sm font-medium">API 密钥</label><div className="relative"><input id="routing-key" autoComplete="off" type={showKey ? 'text' : 'password'} value={apiKey} onChange={event => { setApiKey(event.target.value); setFeedback(null); setModelIds([]); }} placeholder={draft.api_key_masked ? '留空保留现有密钥' : '输入 API 密钥'} className={control + ' pr-12'} /><button type="button" aria-label={showKey ? '隐藏 API 密钥' : '显示 API 密钥'} aria-pressed={showKey} onClick={() => setShowKey(value => !value)} className="absolute inset-y-0 right-0 px-3 text-stone-600 focus-visible:outline-2 focus-visible:outline-emerald-700">{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>{draft.api_key_masked && <p className="mt-1 text-xs text-stone-600">已有密钥：{draft.api_key_masked}</p>}<p className="mt-2 text-xs leading-5 text-stone-600">密钥保存在本机配置服务中，调用时发送给你配置的模型服务用于认证。</p></div>
                <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><label htmlFor="routing-model" className="text-sm font-medium">模型 ID</label><button type="button" disabled={!draft.base_url.trim() || fetchingModels} className={quietButton + ' text-emerald-800'} onClick={() => void fetchModels()}>{fetchingModels ? '正在获取…' : '获取可用模型'}</button></div><input id="routing-model" value={draft.model_name} onChange={event => update('model_name', event.target.value)} placeholder="输入模型 ID" className={control} />{modelIds.length > 0 && <select aria-label="可用模型目录" value={modelIds.includes(draft.model_name) ? draft.model_name : ''} onChange={event => { if (event.target.value) update('model_name', event.target.value); }} className={control + ' mt-2'}><option value="" disabled>从目录选择模型</option>{modelIds.map(id => <option key={id} value={id}>{id}</option>)}</select>}<p className="mt-2 text-xs leading-5 text-stone-600">可直接输入模型 ID；获取目录不会保存配置。</p>{modelFeedback && <p role="status" className={'mt-2 text-xs leading-5 ' + (modelFeedback.ok ? 'text-emerald-800' : 'text-red-700')}>{modelFeedback.text}</p>}</div>
              </fieldset> : null}
            </>}
          </div>
          {section === 'routing' && <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-6 py-4">
            <div role="status" aria-live="polite" className={'min-w-0 flex-1 text-sm leading-5 ' + (feedback && !feedback.ok ? 'text-red-700' : 'text-stone-600')}>{saving ? '正在保存…' : feedback?.text || (dirty ? validation || '有未保存的修改' : baseline ? '没有未保存的修改' : '读取成功后才能保存')}</div>
            <button type="button" onClick={() => void save()} disabled={!baseline || loadError || loading || saving || fetchingModels || !dirty || Boolean(validation)} className={primaryButton}>保存路由配置</button>
          </footer>}
        </div>
      </div>}
    </div>
  </dialog>;
}
