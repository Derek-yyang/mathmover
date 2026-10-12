'use client';

/**
 * 内置构造 Agent（BYOK）的端点配置 —— 「没有 agent CLI 也能用」的那条通路。
 *
 * 对齐 OpenDesign 的 byok 模式：用户自带 OpenAI 兼容端点 + key + 模型，
 * 本机不需要装任何 agent CLI。密钥只存浏览器 localStorage、随请求经回环
 * 传给本机服务，不落服务端磁盘——与「密钥归用户配置」的既有裁决一致。
 */

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { loadByokConfig, saveByokConfig, isByokConfigured, type ByokConfig } from '@/lib/byok-config';

const input = 'mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus-visible:outline-2 focus-visible:outline-emerald-700';
const action = 'rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';

export default function ByokSettings() {
  const [config, setConfig] = useState<ByokConfig>({ baseUrl: '', apiKey: '', model: '' });
  const [saved, setSaved] = useState(false);
  useEffect(() => { setConfig(loadByokConfig()); }, []);

  const configured = isByokConfigured(config);
  return (
    <section aria-labelledby="byok-heading" className="border-t border-stone-200 pt-6">
      <h3 id="byok-heading" className="text-base font-semibold text-stone-900">内置构造 Agent（BYOK）</h3>
      <p className="mt-2 text-sm leading-6 text-stone-600">
        不安装任何 agent CLI 也能生成课件：自带一个 OpenAI 兼容的 API 端点、密钥和模型。
        密钥只存在本浏览器里、随请求发给本机服务，不写入服务端磁盘或课件库。
      </p>
      <div className="mt-4 grid gap-3">
        <label className="block text-sm text-stone-700">API 端点
          <input className={input} type="url" placeholder="https://api.openai.com/v1 或 http://127.0.0.1:15721/v1"
            value={config.baseUrl} onChange={e => { setConfig({ ...config, baseUrl: e.target.value }); setSaved(false); }} />
        </label>
        <label className="block text-sm text-stone-700">API 密钥（本地端点可留空）
          <input className={input} type="password" autoComplete="off" placeholder="sk-…"
            value={config.apiKey} onChange={e => { setConfig({ ...config, apiKey: e.target.value }); setSaved(false); }} />
        </label>
        <label className="block text-sm text-stone-700">模型
          <input className={input} type="text" placeholder="端点认得的模型 id"
            value={config.model} onChange={e => { setConfig({ ...config, model: e.target.value }); setSaved(false); }} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className={action + ' bg-emerald-700 text-white hover:bg-emerald-800'}
          onClick={() => { saveByokConfig(config); setSaved(true); }}>
          保存
        </button>
        <p role="status" className="flex items-center gap-1.5 text-sm text-stone-600">
          {saved && <><Check className="h-4 w-4 text-emerald-700" aria-hidden="true" />已保存</>}
          {!saved && (configured ? '已配置；在聊天区的 Agent 选择器里选「内置构造 Agent」即可使用。' : '填好端点与模型后生效。')}
        </p>
      </div>
    </section>
  );
}
