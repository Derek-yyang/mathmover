'use client';

/**
 * 「API 提供商」设置面 —— BYOK 内置构造 Agent 作为一张提供商卡。
 *
 * 密钥模型（对齐 OpenDesign 桌面化形态）：key 由本机应用的数据目录保管，
 * 界面只显示「已配置（•••• 尾4位）」；改端点/模型时密钥留空即保留。
 * 连接测试探 `${baseUrl}/models`（多数 OpenAI 兼容端点都有），不发模型请求。
 */

import { useEffect, useState } from 'react';
import { Check, KeyRound, Loader2 } from 'lucide-react';
import { fetchByokConfig, saveByokConfig, type ByokConfigView } from '@/lib/byok-config';
import { useAgentRuntimeState } from '../dashboard/AgentRuntimeState';

const input = 'mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-800 focus-visible:outline-2 focus-visible:outline-emerald-700';
const action = 'rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';

type TestState = { running: boolean; result?: { ok: boolean; message: string } };

export default function ByokSettings() {
  const { runtimes, activeRuntimeId, busy, detecting, selectRuntime } = useAgentRuntimeState();
  const selected = activeRuntimeId === 'byok';
  const runtime = runtimes.find(item => item.id === 'byok');
  const [view, setView] = useState<ByokConfigView>({ baseUrl: '', model: '', apiKeyConfigured: false, apiKeyTail: '' });
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [test, setTest] = useState<TestState>({ running: false });

  useEffect(() => {
    void fetchByokConfig().then((v) => {
      setView(v);
      setBaseUrl(v.baseUrl);
      setModel(v.model);
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const configured = !!view.baseUrl && !!view.model;
  const runTest = () => {
    setTest({ running: true });
    void fetch('/api/agent/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runtimeId: 'byok' }),
    }).then(async (res) => {
      const data = await res.json() as { ok?: boolean; message?: string };
      setTest({ running: false, result: { ok: data.ok === true, message: data.message ?? (res.ok ? '测试完成。' : `测试失败（HTTP ${res.status}）。`) } });
    }).catch((e) => {
      setTest({ running: false, result: { ok: false, message: `测试请求失败：${e instanceof Error ? e.message : String(e)}` } });
    });
  };

  return (
    <div>
      <p className="text-sm leading-6 text-stone-600">不安装任何 agent CLI 也能生成课件：填一个 OpenAI 兼容端点、密钥和模型即可。</p>

      <div className={`mt-4 rounded-xl border transition-colors motion-reduce:transition-none ${selected ? 'border-emerald-700/40 bg-emerald-50/50' : 'border-stone-200 bg-white hover:border-stone-300'}`}>
        <div className="flex flex-wrap items-start gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-700" aria-hidden="true">
            <KeyRound className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-stone-900">
              内置构造 Agent（BYOK）
              <span className="ml-2 text-xs font-normal text-stone-500">· 直连 OpenAI 兼容端点 · 无需安装</span>
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-stone-600">
              <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${configured ? 'bg-emerald-100 text-emerald-900' : 'bg-stone-200 text-stone-700'}`}>
                {configured ? (view.apiKeyConfigured ? `已配置 •••• ${view.apiKeyTail}` : '已配置（无密钥）') : '未配置'}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" aria-label="测试 内置构造 Agent（BYOK）" title="测试端点是否可达"
              disabled={test.running || detecting} onClick={runTest}
              className={action + ' text-stone-700 hover:bg-stone-100'}>
              {test.running ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />测试中…</> : '测试'}
            </button>
            <button type="button"
              className={action + (selected ? ' flex items-center gap-1.5 text-emerald-800' : ' text-stone-700 hover:bg-stone-100')}
              disabled={busy || detecting || selected || runtime?.usable === false}
              onClick={() => selectRuntime('byok')}
              aria-label={(selected ? '当前使用 ' : '使用 ') + '内置构造 Agent（BYOK）'}>
              {selected ? <><Check className="h-4 w-4" aria-hidden="true" />当前使用</> : '使用'}
            </button>
          </div>
        </div>

        <div className="border-t border-stone-200 px-4 pb-4 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-stone-600 sm:col-span-2">API 端点
              <input className={input} type="url" placeholder="https://api.openai.com/v1 或 http://127.0.0.1:15721/v1"
                value={baseUrl} onChange={e => { setBaseUrl(e.target.value); setSaved(false); }} />
            </label>
            <label className="block text-xs font-medium text-stone-600">
              {view.apiKeyConfigured ? `API 密钥（已配置 •••• ${view.apiKeyTail}，留空保留）` : 'API 密钥（本地端点可留空）'}
              <input className={input} type="password" autoComplete="off" placeholder={view.apiKeyConfigured ? '留空则不更换' : 'sk-…'}
                value={apiKey} onChange={e => { setApiKey(e.target.value); setSaved(false); }} />
            </label>
            <label className="block text-xs font-medium text-stone-600">模型
              <input className={input} type="text" placeholder="端点认得的模型 id"
                value={model} onChange={e => { setModel(e.target.value); setSaved(false); }} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className={action + ' bg-emerald-700 text-white hover:bg-emerald-800'}
              onClick={() => {
                void saveByokConfig({ baseUrl, model, apiKey }).then((v) => {
                  setView(v);
                  setApiKey('');
                  setSaved(true);
                  setError('');
                }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
              }}>
              保存
            </button>
            <p role="status" className="flex items-center gap-1.5 text-sm text-stone-600">
              {saved && <><Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />已保存</>}
              {!saved && (configured ? '密钥由本机 MathMover 保管，不进课件备份。' : '填好端点与模型后生效。')}
            </p>
          </div>
          <p className="mt-3 text-xs leading-5 text-stone-600">
            任何 OpenAI 兼容端点均可（含本地代理）。端点与模型在此配置，密钥只存应用数据目录、界面只显尾 4 位。
          </p>
          {error && <p role="alert" className="mt-2 text-sm leading-5 text-amber-900">{error}</p>}
        </div>

        {test.result && (
          <p role="status" className={`border-t border-stone-200 px-4 py-2.5 text-xs leading-5 ${test.result.ok ? 'text-emerald-800' : 'text-amber-900'}`}>
            测试结果：{test.result.message}
          </p>
        )}
      </div>
    </div>
  );
}
