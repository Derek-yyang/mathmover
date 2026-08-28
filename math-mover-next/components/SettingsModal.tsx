"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Check, Eye, EyeOff } from "lucide-react";

interface ConfigResponse {
  provider: "openai_compatible" | "gemini";
  base_url?: string;
  model_name?: string;
  api_key_masked?: string;
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState<"openai_compatible" | "gemini">("openai_compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyMasked, setKeyMasked] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: ConfigResponse) => {
        setProvider(cfg.provider || "openai_compatible");
        setBaseUrl(cfg.base_url || "");
        setModelName(cfg.model_name || "");
        setKeyMasked(cfg.api_key_masked || "");
      })
      .catch(() => setMessage({ ok: false, text: "无法读取后端配置，请确认后端已启动" }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, string> = {
        provider,
        base_url: baseUrl,
        model_name: modelName,
      };
      // key 留空 = 保留后端现有 key
      if (apiKey.trim()) body.api_key = apiKey.trim();

      const resp = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setMessage({ ok: false, text: data.error || "保存失败" });
      } else {
        setMessage({ ok: true, text: "已保存，立即生效" });
        setApiKey("");
        const cfg = await fetch("/api/config").then((r) => r.json());
        setKeyMasked(cfg.api_key_masked || "");
      }
    } catch {
      setMessage({ ok: false, text: "网络错误，请确认后端已启动" });
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full bg-white border border-stone-200 rounded-xl px-3 py-2.5 text-sm font-bold text-stone-700 focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100/50 transition-all placeholder:text-stone-300 placeholder:font-medium";
  const labelCls = "text-xs font-black text-stone-500 uppercase tracking-wider";

  return (
    <div
      className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#FDFCF8] rounded-3xl border border-stone-200 shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100">
          <h2 className="font-black text-stone-800 text-lg">模型设置</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-stone-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {/* 提供商切换 */}
            <div className="space-y-2">
              <label className={labelCls}>模型类型</label>
              <div className="flex gap-1 bg-stone-100 p-1 rounded-full border border-stone-200">
                {(
                  [
                    { id: "openai_compatible", label: "OpenAI 兼容" },
                    { id: "gemini", label: "Gemini" },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setProvider(item.id)}
                    className={`flex-1 py-2 rounded-full text-sm font-bold transition-all ${
                      provider === item.id
                        ? "bg-white text-emerald-600 shadow-sm"
                        : "text-stone-400 hover:text-stone-600"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {provider === "openai_compatible" ? (
              <>
                <div className="space-y-2">
                  <label className={labelCls}>Base URL</label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className={inputCls}
                  />
                </div>
                <div className="space-y-2">
                  <label className={labelCls}>模型名称</label>
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="例如 qwen3.5-plus / glm-4.5v / deepseek-chat"
                    className={inputCls}
                  />
                </div>
              </>
            ) : (
              <p className="text-xs text-stone-500 font-medium leading-relaxed bg-stone-50 rounded-xl p-3 border border-stone-100">
                Gemini 模式使用官方接口。模型默认为 gemini-3-flash-preview，可通过环境变量 GEMINI_MODEL_NAME 调整。注意：部分地区网络需要代理才能访问 Gemini。
              </p>
            )}

            {/* API Key */}
            <div className="space-y-2">
              <label className={labelCls}>
                API Key{keyMasked && <span className="ml-2 normal-case font-bold text-stone-400">当前: {keyMasked}</span>}
              </label>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={keyMasked ? "留空则保留现有 Key" : "粘贴你的 API Key"}
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-300 hover:text-stone-500"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {provider === "openai_compatible" && (
                <p className="text-[11px] text-stone-400 font-medium">
                  Key 保存在本机后端 config.json，不会上传到任何第三方。
                </p>
              )}
            </div>

            {/* 结果提示 */}
            {message && (
              <div
                className={`flex items-center gap-2 text-sm font-bold rounded-xl px-4 py-3 ${
                  message.ok
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-red-50 text-red-600"
                }`}
              >
                {message.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                {message.text}
              </div>
            )}

            {/* 保存 */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white font-bold py-3 rounded-full transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              保存配置
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
