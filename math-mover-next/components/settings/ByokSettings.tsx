'use client';

/**
 * 「模型 API」设置面 —— BYOK 内置构造 Agent 作为一张提供商卡。
 *
 * 密钥模型（对齐 OpenDesign 桌面化形态）：key 由本机应用的数据目录保管，
 * 界面只显示「已配置（•••• 尾4位）」；改端点/模型时密钥留空即保留。
 * 测试调用按已保存的接口格式向模型发送一次简短请求；获取模型列表是独立操作。
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Check, KeyRound, Loader2 } from 'lucide-react';
import { API_FORMATS, DEFAULT_API_FORMAT, isApiFormat, fetchByokConfig, fetchByokModelList, saveByokConfig, type ApiFormat, type ByokConfigView } from '@/lib/byok-config';
// ⚠ 从**具体模块**引，不要从 `@mathmover/agent-runtime` 包入口引：包入口会把
// 整个运行时（含用 `node:fs` 的 claude-env.ts）拖进浏览器 bundle，编译直接失败。
// 这个模块只依赖 api-format.ts，是纯数据/纯函数，客户端安全（同 byok-config.ts 的引法）。
import { effectiveReasoningLevels, normalizeReasoningLevels, reasoningDialect, REASONING_LEVEL_VOCABULARY } from '../../../packages/agent-runtime/src/opencode-config.ts';
import { ReasoningEffortSelector } from './ReasoningEffortSelector';
import { effortDisplay } from '@/lib/agent-picker';
import { useAgentRuntimeState } from '../dashboard/AgentRuntimeState';
import { SettingsButton, SettingsStatusBadge } from './SettingsControls';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../assistant-ui/ui/select';
import { ByokModelField, type ModelListState } from './ByokModelField';

const input = 'mt-1 w-full rounded-lg border border-[var(--mm-border-stone-300)] bg-[var(--mm-surface)] px-2.5 py-1.5 text-sm text-[var(--mm-text-stone-800)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]';

type TestState = { running: boolean; result?: { ok: boolean; message: string } };
export type SettingsDraftState = { dirty: boolean; saving: boolean };

export default function ByokSettings({ onDraftStateChange }: { onDraftStateChange?: (state: SettingsDraftState) => void }) {
  const { runtimes, activeRuntimeId, busy, detecting, selectRuntime, updateRuntime, modelFor, effortFor, selectModelFor, selectEffortFor } = useAgentRuntimeState();
  const selected = activeRuntimeId === 'byok';
  const runtime = runtimes.find(item => item.id === 'byok');
  const [view, setView] = useState<ByokConfigView>({ apiFormat: DEFAULT_API_FORMAT, baseUrl: '', model: '', reasoningLevels: '', apiKeyConfigured: false, apiKeyTail: '' });
  const [apiFormat, setApiFormat] = useState<ApiFormat>(DEFAULT_API_FORMAT);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [reasoningLevels, setReasoningLevels] = useState('');
  const [effortDraft, setEffortDraft] = useState<string>();
  /** 与 reasoningLevels 同步的镜像：连点开关时 state 还没重渲染，要读最新值 */
  const levelsRef = useRef('');
  const [apiKey, setApiKey] = useState('');
  // This field replaces an API secret; it is not a saved login password.
  // Only unlock on focus so opening settings cannot silently autofill a draft.
  const [editingKey, setEditingKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [test, setTest] = useState<TestState>({ running: false });
  const testRequest = useRef<AbortController | null>(null);
  const modelsRequest = useRef<AbortController | null>(null);
  const [modelList, setModelList] = useState<ModelListState>({ loading: false });
  const [modelsOpen, setModelsOpen] = useState(false);
  const savePending = useRef(false);
  const loadPending = useRef(true);
  const statusId = useId();

  useEffect(() => {
    let cancelled = false;
    void fetchByokConfig().then((v) => {
      if (cancelled) return;
      setView(v);
      setApiFormat(v.apiFormat);
      setBaseUrl(v.baseUrl);
      setModel(v.model);
      applyLevels(v.reasoningLevels ?? '');
      setLoaded(true);
    }).catch((e) => {
      if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
    }).finally(() => {
      if (!cancelled) { loadPending.current = false; setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  useEffect(() => () => {
    testRequest.current?.abort(); testRequest.current = null;
    modelsRequest.current?.abort(); modelsRequest.current = null;
  }, []);

  const retryLoad = () => {
    // Retry only the initial read: never replace an editable, unsaved draft.
    if (loaded || loadPending.current) return;
    loadPending.current = true;
    setLoadError('');
    setLoading(true);
    setLoadAttempt(attempt => attempt + 1);
  };

  const configured = !!view.baseUrl && !!view.model;
  const configIsDirty = (url: string, modelId: string, key: string, format = apiFormat, levels = reasoningLevels) => url !== view.baseUrl || modelId !== view.model || key !== '' || format !== view.apiFormat || (levels ?? '') !== (view.reasoningLevels ?? '');
  const hasEffortDraft = (format = apiFormat, levels = reasoningLevels) => !!effortDraft && !!reasoningDialect(format) && effectiveReasoningLevels(levels).includes(effortDraft);
  const isDirty = (url: string, modelId: string, key: string, format = apiFormat, levels = reasoningLevels) => configIsDirty(url, modelId, key, format, levels) || hasEffortDraft(format, levels);
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
  const updateDraft = (url: string, modelId: string, key: string, format = apiFormat) => {
    invalidateTest();
    const changedTarget = url !== baseUrl || modelId !== model || format !== apiFormat;
    if (changedTarget) setEffortDraft(undefined);
    if (url !== baseUrl || key !== apiKey || format !== apiFormat) {
      modelsRequest.current?.abort(); modelsRequest.current = null;
      setModelList({ loading: false }); setModelsOpen(false);
    }
    setBaseUrl(url); setModel(modelId); setApiKey(key);
    setApiFormat(format);
    // Publish in the input event so a subsequent close cannot read stale state.
    onDraftStateChange?.({ dirty: loaded && (configIsDirty(url, modelId, key, format) || (!changedTarget && hasEffortDraft(format))), saving: false });
  };
  /** 档位清单单独一路：它不是端点属性，改了不需要重新拉模型列表。 */
  const updateReasoningLevels = (levels: string) => {
    invalidateTest();
    applyLevels(levels);
    if (effortDraft && !effectiveReasoningLevels(levels).includes(effortDraft)) setEffortDraft(undefined);
    onDraftStateChange?.({ dirty: loaded && isDirty(baseUrl, model, apiKey, apiFormat, levels), saving: false });
  };
  // 生效的档位：**存空 = 用默认那三个**（与 opencode 自己的默认一致）
  // 读的是 ref 不是 state：连点几个开关时，state 还没重渲染，用 state 会算出
  // 过期结果（实测点出过重复的 high）。ref 在每次写入时同步更新。
  const levels = effectiveReasoningLevels(reasoningLevels);
  const dialect = reasoningDialect(apiFormat);
  const applyLevels = (raw: string) => {
    levelsRef.current = raw;
    setReasoningLevels(raw);
  };
  const commitLevels = (next: string[]) => {
    updateReasoningLevels(normalizeReasoningLevels(next).join(','));
  };
  // Read the same per-Agent/model selection as the composer. A changed API/model
  // gets its own draft until saving succeeds, never the previous model's choice.
  const targetChanged = baseUrl !== view.baseUrl || model !== view.model || apiFormat !== view.apiFormat;
  const effortModel = targetChanged ? model.trim() || 'default' : modelFor('byok');
  const previewOptions = levels.map(id => ({ id, label: id }));
  const currentEffort = effortDisplay(previewOptions, hasEffortDraft() ? effortDraft : effortFor('byok', effortModel));
  const chooseEffort = (id: string) => {
    if (!loaded || busy || saving || test.running || !dialect || !levels.includes(id)) return;
    if (dirty) {
      setEffortDraft(id);
      setSaved(false);
      onDraftStateChange?.({ dirty: true, saving: false });
    } else {
      selectEffortFor('byok', effortModel, id);
    }
  };
  const toggleLevel = (value: string) => {
    const current = effectiveReasoningLevels(levelsRef.current);
    const on = current.includes(value);
    // `none` 与别的档位互斥——它本身就是"不要推理档位"这个真值
    const next = on
      ? current.filter(item => item !== value)
      : value === 'none' ? ['none'] : [...current.filter(item => item !== 'none'), value];
    // 一个都不剩就落成 `none`：不让"空"同时表示"没选"和"用默认"两件事
    commitLevels(next.length ? next : ['none']);
  };
  const getModels = () => {    if (!loaded || savePending.current || modelsRequest.current || !baseUrl.trim()) return;
    const controller = new AbortController();
    modelsRequest.current = controller;
    setModelList({ loading: true }); setModelsOpen(false);
    void fetchByokModelList({ apiFormat, baseUrl, apiKey }, controller.signal).then(models => {
      if (modelsRequest.current !== controller) return;
      setModelList({ loading: false, models }); setModelsOpen(models.length > 0);
    }).catch(e => {
      if (modelsRequest.current !== controller) return;
      setModelList({ loading: false, error: e instanceof Error ? e.message : '获取模型列表失败，请重试或手动输入。' });
    }).finally(() => { if (modelsRequest.current === controller) modelsRequest.current = null; });
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
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (testRequest.current !== controller) return;
      setTest({ running: false, result: { ok: res.ok && data.ok === true, message: data.message ?? data.error ?? (res.ok ? '测试完成。' : `测试失败（HTTP ${res.status}）。`) } });
    }).catch((e) => {
      if (testRequest.current !== controller) return;
      setTest({ running: false, result: { ok: false, message: `测试请求失败：${e instanceof Error ? e.message : String(e)}` } });
    }).finally(() => { if (testRequest.current === controller) testRequest.current = null; });
  };

  const save = () => {
    if (!loaded || !dirty || savePending.current || testRequest.current) return;
    savePending.current = true;
    if (modelsRequest.current) {
      modelsRequest.current.abort(); modelsRequest.current = null;
      setModelList({ loading: false }); setModelsOpen(false);
    }
    invalidateTest();
    setSaving(true);
    onDraftStateChange?.({ dirty, saving: true });
    void saveByokConfig({ baseUrl, model, apiKey, apiFormat, reasoningLevels }).then(({ runtime: savedRuntime, ...v }) => {
      setView(v);
      // Display the server's normalized values so testing uses this exact configuration.
      setBaseUrl(v.baseUrl);
      setModel(v.model);
      applyLevels(v.reasoningLevels ?? '');
      setApiFormat(v.apiFormat);
      setApiKey('');
      if (hasEffortDraft(v.apiFormat, v.reasoningLevels ?? '')) {
        const savedEffortModel = targetChanged ? v.model || 'default' : effortModel;
        if (targetChanged) selectModelFor('byok', savedEffortModel);
        selectEffortFor('byok', savedEffortModel, effortDraft!);
      } else {
        const allowed = reasoningDialect(v.apiFormat) ? effectiveReasoningLevels(v.reasoningLevels) : [];
        const previous = effortFor('byok', effortModel);
        if (previous && !allowed.includes(previous)) selectEffortFor('byok', effortModel, undefined);
      }
      setEffortDraft(undefined);
      setSaved(true);
      setError('');
      // Save returns the complete built-in runtime, including first-time auth readiness.
      updateRuntime(savedRuntime);
      onDraftStateChange?.({ dirty: false, saving: false });
    }).catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      onDraftStateChange?.({ dirty, saving: false });
    })
      .finally(() => { savePending.current = false; setSaving(false); });
  };

  return (
    <div>
      <div className={`rounded-xl border transition-colors motion-reduce:transition-none ${selected ? 'border-[var(--mm-border-emerald-700)]/40 bg-[var(--mm-bg-emerald-50)]/50' : 'border-[var(--mm-border-stone-200)] bg-[var(--mm-surface)] hover:border-[var(--mm-border-stone-300)]'}`}>
        <div className="flex flex-wrap items-start gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--mm-bg-stone-100)] text-[var(--mm-text-stone-700)]" aria-hidden="true">
            <KeyRound className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold text-[var(--mm-text-stone-900)]">
              <span className="min-w-0 truncate">内置 Agent</span>
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-[var(--mm-text-stone-600)]">
              <SettingsStatusBadge tone={configured ? 'success' : 'neutral'}>
                {configured ? (view.apiKeyConfigured ? '已配置' : '已配置（无密钥）') : '未配置'}
              </SettingsStatusBadge>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SettingsButton type="button" aria-label="测试调用 内置 Agent" title={testHint ?? '向已保存的模型发送一次简短请求，可能产生少量费用'}
              aria-describedby={testHint ? statusId : undefined}
              disabled={test.running || detecting || !!testHint} aria-busy={test.running} onClick={runTest}>
              {test.running ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />测试中…</> : '测试调用'}
            </SettingsButton>
            {selected ? <span aria-label="当前使用 内置 Agent"
              className="inline-flex h-8 items-center gap-1.5 px-3 text-sm font-medium text-[var(--mm-text-emerald-800)]">
              <Check className="h-4 w-4" aria-hidden="true" />当前使用
            </span> : <SettingsButton type="button"
              disabled={busy || detecting || runtime?.usable === false} onClick={() => selectRuntime('byok')}
              aria-label="使用 内置 Agent">使用</SettingsButton>}
          </div>
        </div>

        <div ref={setPortalContainer} className="border-t border-[var(--mm-border-stone-200)] px-4 pb-4 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="text-xs font-medium text-[var(--mm-text-stone-600)] sm:col-span-2">
              <label htmlFor={`${statusId}-format`}>接口格式</label>
              <Select value={apiFormat} disabled={!loaded || saving} onValueChange={value => {
                if (isApiFormat(value)) updateDraft(baseUrl, model, apiKey, value);
              }}>
                <SelectTrigger id={`${statusId}-format`} size="sm" aria-label="接口格式"
                  className="mt-1 w-full border-[var(--mm-border-stone-300)] bg-[var(--mm-surface)] text-[var(--mm-text-stone-800)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent portalContainer={portalContainer} position="popper" align="start"
                  collisionBoundary={portalContainer?.closest('[data-slot="settings-dialog"]')} collisionPadding={12}
                  className="max-w-[calc(100vw-48px)]">
                  {API_FORMATS.map(format => <SelectItem key={format.id} value={format.id}>{format.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className="block text-xs font-medium text-[var(--mm-text-stone-600)] sm:col-span-2">API 端点
              <input className={input} type="url" placeholder={API_FORMATS.find(format => format.id === apiFormat)?.placeholder}
                disabled={!loaded || saving} value={baseUrl} onChange={e => updateDraft(e.target.value, model, apiKey)} />
            </label>
            <div className="min-w-0 text-xs font-medium leading-5 text-[var(--mm-text-stone-600)]">
              <label htmlFor={`${statusId}-key`}>API 密钥</label>
              <input id={`${statusId}-key`} aria-describedby={`${statusId}-key-hint`}
                className={input} type="password" name="mathmover-api-key" autoComplete="new-password"
                readOnly={!editingKey} onFocus={() => setEditingKey(true)} onBlur={() => setEditingKey(false)}
                placeholder={view.apiKeyConfigured ? '输入新密钥以更换' : 'sk-…'}
                disabled={!loaded || saving} value={apiKey} onChange={e => updateDraft(baseUrl, model, e.target.value)} />
              <p id={`${statusId}-key-hint`} className="mt-1 text-xs font-normal leading-4 text-[var(--mm-text-stone-600)]">
                {loading ? '正在读取密钥状态…' : !loaded ? '配置读取失败，请重试。'
                  : view.apiKeyConfigured ? `已配置 •••• ${view.apiKeyTail}，留空则保留。` : '本地端点可留空。'}
              </p>
            </div>
            <ByokModelField value={model} onChange={value => updateDraft(baseUrl, value, apiKey)}
              disabled={!loaded || saving} canFetch={!!baseUrl.trim()} list={modelList} onFetch={getModels}
              open={modelsOpen} onOpenChange={setModelsOpen} portalContainer={portalContainer} inputClassName={input} />
            {dialect ? (
              <div className="min-w-0 text-xs font-medium leading-5 text-[var(--mm-text-stone-600)] sm:col-span-2">
                {currentEffort && (
                  <div className="pt-1">
                    <ReasoningEffortSelector options={previewOptions} currentId={currentEffort.option.id} pinned={currentEffort.pinned}
                      onSelect={chooseEffort} disabled={!loaded || busy || saving || test.running}
                      configDisabled={!loaded || saving} vocabulary={REASONING_LEVEL_VOCABULARY}
                      onToggle={toggleLevel} portalContainer={portalContainer} />
                    {hasEffortDraft() && <p role="status" className="mt-2 text-xs leading-5 text-[var(--mm-text-stone-600)]">档位选择将在保存配置后生效。</p>}
                  </div>
                )}
              </div>
            ) : (
              // 没有档位方言的格式（Anthropic / Gemini）**不给控件**：那些格式的
              // 推理强度是另一套参数（thinking budget），我们的字段传过去会被丢掉，
              // 给一个点了没反应的控件比不给更糟。
              <p className="text-xs font-medium leading-5 text-[var(--mm-text-stone-600)] sm:col-span-2">
                推理档位：该接口格式用的是另一套参数（如 thinking budget），本版不支持配置。
              </p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <SettingsButton type="button" variant="default"
              disabled={!loaded || !dirty || saving || test.running} aria-busy={saving}
              onClick={save}>
              {saving ? '保存中…' : saved && !dirty ? <><Check className="h-4 w-4" aria-hidden="true" />已保存</> : '保存'}
            </SettingsButton>
            {/* Success feedback stays in the button; this live region only explains prerequisites. */}
            <p id={statusId} role="status" className="flex items-center gap-1.5 text-sm text-[var(--mm-text-stone-600)]">
              {testHint}
              {saved && !dirty && !testHint && <span className="sr-only">配置已保存。</span>}
            </p>
          </div>
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
