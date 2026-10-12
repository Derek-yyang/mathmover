'use client';

/**
 * 内置构造 Agent（BYOK）的端点配置 —— 「没有 agent CLI 也能用」的那条通路。
 *
 * 密钥模型对齐 OpenDesign（桌面化形态）：key 交给**本机应用的数据目录**保管，
 * 界面只显示「已配置（•••• 尾4位）」；完整值不回传浏览器。改端点/模型时密钥
 * 留空即保留原值。配置不进课件备份（备份只打包 DB 及引用资源）。
 */

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { fetchByokConfig, saveByokConfig, type ByokConfigView } from '@/lib/byok-config';

const input = 'mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus-visible:outline-2 focus-visible:outline-emerald-700';
const action = 'rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';

export default function ByokSettings() {
  const [view, setView] = useState<ByokConfigView>({ baseUrl: '', model: '', apiKeyConfigured: false, apiKeyTail: '' });
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetchByokConfig().then((v) => {
      setView(v);
      setBaseUrl(v.baseUrl);
      setModel(v.model);
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const configured = !!view.baseUrl && !!view.model;
  return (
    <section aria-labelledby="byok-heading" className="border-t border-stone-200 pt-6">
      <h3 id="byok-heading" className="text-base font-semibold text-stone-900">内置构造 Agent（BYOK）</h3>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        不安装任何 agent CLI 也能生成课件：自带一个 OpenAI 兼容的 API 端点、密钥和模型。
        密钥由本机 MathMover 保管（应用数据目录），只显示尾 4 位，且不进入课件备份。
      </p>
      <div className="mt-4 grid gap-3">
        <label className="block text-sm text-stone-700">API 端点
          <input className={input} type="url" placeholder="https://api.openai.com/v1 或 http://127.0.0.1:15721/v1"
            value={baseUrl} onChange={e => { setBaseUrl(e.target.value); setSaved(false); }} />
        </label>
        <label className="block text-sm text-stone-700">
          {view.apiKeyConfigured ? `API 密钥（已配置 •••• ${view.apiKeyTail}，留空保留）` : 'API 密钥（本地端点可留空）'}
          <input className={input} type="password" autoComplete="off" placeholder={view.apiKeyConfigured ? '留空则不更换' : 'sk-…'}
            value={apiKey} onChange={e => { setApiKey(e.target.value); setSaved(false); }} />
        </label>
        <label className="block text-sm text-stone-700">模型
          <input className={input} type="text" placeholder="端点认得的模型 id"
            value={model} onChange={e => { setModel(e.target.value); setSaved(false); }} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
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
          {!saved && (configured ? '已配置；在聊天区的 Agent 选择器里选「内置构造 Agent」即可使用。' : '填好端点与模型后生效。')}
        </p>
      </div>
      {error && <p role="alert" className="mt-2 text-sm leading-5 text-amber-900">{error}</p>}
    </section>
  );
}
