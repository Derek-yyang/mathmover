'use client';

/**
 * 「API 提供商」设置面 —— BYOK 内置构造 Agent 作为一张提供商卡。
 *
 * 密钥模型（对齐 OpenDesign 桌面化形态）：key 由本机应用的数据目录保管，
 * 界面只显示「已配置（•••• 尾4位）」；改端点/模型时密钥留空即保留。
 * 连接测试探 `${baseUrl}/models`（多数 OpenAI 兼容端点都有），不发模型请求。
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Check, KeyRound, Loader2 } from 'lucide-react';
import { fetchByokConfig, saveByokConfig, type ByokConfigView } from '@/lib/byok-config';
import { useAgentRuntimeState } from '../dashboard/AgentRuntimeState';
import { SettingsButton, SettingsStatusBadge } from './SettingsControls';

const input = 'mt-1 w-full rounded-lg border border-[var(--mm-border-stone-300)] bg-[var(--mm-surface)] px-2.5 py-1.5 text-sm text-[var(--mm-text-stone-800)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]';

type TestState = { running: boolean; result?: { ok: boolean; message: string } };
export type SettingsDraftState = { dirty: boolean; saving: boolean };

export default function ByokSettings({ onDraftStateChange }: { onDraftStateChange?: (state: SettingsDraftState) => void }) {
  const { runtimes, activeRuntimeId, busy, detecting, selectRuntime } = useAgentRuntimeState();
  const selected = activeRuntimeId === 'byok';
  const runtime = runtimes.find(item => item.id === 'byok');
  const [view, setView] = useState<ByokConfigView>({ baseUrl: '', model: '', apiKeyConfigured: false, apiKeyTail: '' });
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [test, setTest] = useState<TestState>({ running: false });
  const testRequest = useRef<AbortController | null>(null);
  const savePending = useRef(false);
  const loadPending = useRef(true);
  const statusId = useId();

  useEffect(() => {
    let cancelled = false;
    void fetchByokConfig().then((v) => {
      if (cancelled) return;
      setView(v);
      setBaseUrl(v.baseUrl);
      setModel(v.model);
      setLoaded(true);
    }).catch((e) => {
      if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
    }).finally(() => {
      if (!cancelled) { loadPending.current = false; setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  useEffect(() => () => { testRequest.current?.abort(); testRequest.current = null; }, []);

  const retryLoad = () => {
    // Retry only the initial read: never replace an editable, unsaved draft.
    if (loaded || loadPending.current) return;
    loadPending.current = true;
    setLoadError('');
    setLoading(true);
    setLoadAttempt(attempt => attempt + 1);
  };

  const configured = !!view.baseUrl && !!view.model;
  const isDirty = (url: string, modelId: string, key: string) => url !== view.baseUrl || modelId !== view.model || key !== '';
  const dirty = isDirty(baseUrl, model, apiKey);
  const testHint = loading ? '正在读取配置…' : !loaded ? '配置读取失败，请重试。'
    : saving ? '保存中，完成后再测试。' : dirty ? '配置已修改，请先保存再测试。'
    : !configured ? '请先填写并保存 API 端点与模型。' : undefined;
  const invalidateTest = () => {
    testRequest.current?.abort();
    testRequest.current = null;
    setTest({ running: false });
    setSaved(false);
  };
  const updateDraft = (url: string, modelId: string, key: string) => {
    invalidateTest();
    setBaseUrl(url); setModel(modelId); setApiKey(key);
    // Publish in the input event so a subsequent close cannot read stale state.
    onDraftStateChange?.({ dirty: loaded && isDirty(url, modelId, key), saving: false });
  };
  const runTest = () => {
    if (!loaded || savePending.current || testRequest.current || detecting || dirty || !configured) return;
    const controller = new AbortController();
    testRequest.current = controller;
    setTest({ running: true });
    void fetch('/api/agent/test', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runtimeId: 'byok' }),
    }).then(async (res) => {
      const data = await res.json() as { ok?: boolean; message?: string };
      if (testRequest.current !== controller) return;
      setTest({ running: false, result: { ok: data.ok === true, message: data.message ?? (res.ok ? '测试完成。' : `测试失败（HTTP ${res.status}）。`) } });
    }).catch((e) => {
      if (testRequest.current !== controller) return;
      setTest({ running: false, result: { ok: false, message: `测试请求失败：${e instanceof Error ? e.message : String(e)}` } });
    }).finally(() => { if (testRequest.current === controller) testRequest.current = null; });
  };

  const save = () => {
    if (!loaded || savePending.current || testRequest.current) return;
    savePending.current = true;
    invalidateTest();
    setSaving(true);
    onDraftStateChange?.({ dirty, saving: true });
    void saveByokConfig({ baseUrl, model, apiKey }).then((v) => {
      setView(v);
      // Display the server's normalized values so testing uses this exact configuration.
      setBaseUrl(v.baseUrl);
      setModel(v.model);
      setApiKey('');
      setSaved(true);
      setError('');
      onDraftStateChange?.({ dirty: false, saving: false });
    }).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      onDraftStateChange?.({ dirty, saving: false });
    })
      .finally(() => { savePending.current = false; setSaving(false); });
  };

  return (
    <div>
      <p className="mt-1 max-w-[68ch] text-sm leading-6 text-[var(--mm-text-stone-600)]">不安装任何 agent CLI 也能生成课件：填一个 OpenAI 兼容端点、密钥和模型即可。</p>

      <div className={`mt-4 rounded-xl border transition-colors motion-reduce:transition-none ${selected ? 'border-[var(--mm-border-emerald-700)]/40 bg-[var(--mm-bg-emerald-50)]/50' : 'border-[var(--mm-border-stone-200)] bg-[var(--mm-surface)] hover:border-[var(--mm-border-stone-300)]'}`}>
        <div className="flex flex-wrap items-start gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--mm-bg-stone-100)] text-[var(--mm-text-stone-700)]" aria-hidden="true">
            <KeyRound className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-[var(--mm-text-stone-900)]">
              <span className="min-w-0 truncate">内置构造 Agent（BYOK）</span>
              <span className="text-xs font-medium text-[var(--mm-text-stone-600)]">· 直连 OpenAI 兼容端点 · 无需安装</span>
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-[var(--mm-text-stone-600)]">
              <SettingsStatusBadge tone={configured ? 'success' : 'neutral'}>
                {configured ? (view.apiKeyConfigured ? `已配置 •••• ${view.apiKeyTail}` : '已配置（无密钥）') : '未配置'}
              </SettingsStatusBadge>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SettingsButton type="button" aria-label="测试 内置构造 Agent（BYOK）" title={testHint ?? '测试已保存的端点是否可达'}
              aria-describedby={testHint ? statusId : undefined}
              disabled={test.running || detecting || !!testHint} aria-busy={test.running} onClick={runTest}>
              {test.running ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />测试中…</> : '测试'}
            </SettingsButton>
            {selected ? <span aria-label="当前使用 内置构造 Agent（BYOK）"
              className="inline-flex h-8 items-center gap-1.5 px-3 text-sm font-medium text-[var(--mm-text-emerald-800)]">
              <Check className="h-4 w-4" aria-hidden="true" />当前使用
            </span> : <SettingsButton type="button"
              disabled={busy || detecting || runtime?.usable === false} onClick={() => selectRuntime('byok')}
              aria-label="使用 内置构造 Agent（BYOK）">使用</SettingsButton>}
          </div>
        </div>

        <div className="border-t border-[var(--mm-border-stone-200)] px-4 pb-4 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-[var(--mm-text-stone-600)] sm:col-span-2">API 端点
              <input className={input} type="url" placeholder="https://api.openai.com/v1 或 http://127.0.0.1:15721/v1"
                disabled={!loaded || saving} value={baseUrl} onChange={e => updateDraft(e.target.value, model, apiKey)} />
            </label>
            <label className="block text-xs font-medium text-[var(--mm-text-stone-600)]">
              {view.apiKeyConfigured ? `API 密钥（已配置 •••• ${view.apiKeyTail}，留空保留）` : 'API 密钥（本地端点可留空）'}
              <input className={input} type="password" autoComplete="off" placeholder={view.apiKeyConfigured ? '留空则不更换' : 'sk-…'}
                disabled={!loaded || saving} value={apiKey} onChange={e => updateDraft(baseUrl, model, e.target.value)} />
            </label>
            <label className="block text-xs font-medium text-[var(--mm-text-stone-600)]">模型
              <input className={input} type="text" placeholder="端点认得的模型 id"
                disabled={!loaded || saving} value={model} onChange={e => updateDraft(baseUrl, e.target.value, apiKey)} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <SettingsButton type="button" variant="default"
              disabled={!loaded || saving || test.running} aria-busy={saving}
              onClick={save}>
              {saving ? '保存中…' : '保存'}
            </SettingsButton>
            <p id={statusId} role="status" className="flex items-center gap-1.5 text-sm text-[var(--mm-text-stone-600)]">
              {testHint}
              {!testHint && (saved ? <><Check className="h-4 w-4 text-[var(--mm-text-emerald-700)]" aria-hidden="true" />已保存</>
                : '密钥由本机 MathMover 保管，不进课件备份。')}
            </p>
          </div>
          <p className="mt-3 max-w-[68ch] text-xs leading-5 text-[var(--mm-text-stone-600)]">
            任何 OpenAI 兼容端点均可（含本地代理）。端点与模型在此配置，密钥只存应用数据目录、界面只显尾 4 位。
          </p>
          {loadError && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p role="alert" className="text-sm leading-5 text-[var(--mm-text-amber-900)]">{loadError}</p>
            <SettingsButton type="button" onClick={retryLoad}>重试</SettingsButton>
          </div>}
          {error && <p role="alert" className="mt-2 text-sm leading-5 text-[var(--mm-text-amber-900)]">{error}</p>}
        </div>

        {test.result && (
          <p role="status" className={`border-t border-[var(--mm-border-stone-200)] px-4 py-2.5 text-xs leading-5 ${test.result.ok ? 'text-[var(--mm-text-emerald-800)]' : 'text-[var(--mm-text-amber-900)]'}`}>
            测试结果：{test.result.message}
          </p>
        )}
      </div>
    </div>
  );
}
