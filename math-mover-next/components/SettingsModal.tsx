"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Check, Eye, EyeOff, Cpu, Route, ChevronDown } from "lucide-react";

interface ConfigResponse {
  api_protocol?: ApiProtocol;
  base_url?: string;
  model_name?: string;
  api_key_masked?: string;
  router_mode?: "llm" | "decisions";
  perplexity_api_key_masked?: string;
  decisions_threshold?: string;
}

type ApiProtocol = "openai_chat" | "openai_responses" | "anthropic";

const PROTOCOLS: { id: ApiProtocol; label: string }[] = [
  { id: "openai_chat", label: "OpenAI Chat Completions" },
  { id: "openai_responses", label: "OpenAI Responses" },
  { id: "anthropic", label: "Anthropic Messages" },
];

const SECTIONS = [
  { id: "model", label: "模型", icon: Cpu },
  { id: "routing", label: "分类路由", icon: Route },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<SectionId>("model");
  const [apiProtocol, setApiProtocol] = useState<ApiProtocol>("openai_chat");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [keyMasked, setKeyMasked] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogPos, setCatalogPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [showProtocolMenu, setShowProtocolMenu] = useState(false);
  const [routerMode, setRouterMode] = useState<"llm" | "decisions">("llm");
  const [pplxKey, setPplxKey] = useState("");
  const [pplxKeyMasked, setPplxKeyMasked] = useState("");
  const [threshold, setThreshold] = useState("0.8");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: ConfigResponse) => {
        setApiProtocol(PROTOCOLS.some((p) => p.id === cfg.api_protocol) ? cfg.api_protocol! : "openai_chat");
        setBaseUrl(cfg.base_url || "");
        setModelName(cfg.model_name || "");
        setKeyMasked(cfg.api_key_masked || "");
        setRouterMode(cfg.router_mode === "decisions" ? "decisions" : "llm");
        setPplxKeyMasked(cfg.perplexity_api_key_masked || "");
        setThreshold(cfg.decisions_threshold || "0.8");
      })
      .catch(() => setMessage({ ok: false, text: "无法读取后端配置，请确认后端已启动" }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const body: Record<string, string> = {
        api_protocol: apiProtocol,
        base_url: baseUrl,
        model_name: modelName,
        router_mode: routerMode,
        decisions_threshold: threshold,
      };
      // key 留空 = 保留后端现有 key
      if (apiKey.trim()) body.api_key = apiKey.trim();
      if (pplxKey.trim()) body.perplexity_api_key = pplxKey.trim();

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
        setPplxKey("");
        const cfg = await fetch("/api/config").then((r) => r.json());
        setKeyMasked(cfg.api_key_masked || "");
        setPplxKeyMasked(cfg.perplexity_api_key_masked || "");
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

  const fetchModels = async () => {
    setFetchingModels(true);
    setMessage(null);
    try {
      const body: Record<string, string> = { base_url: baseUrl, api_protocol: apiProtocol };
      if (apiKey.trim()) body.api_key = apiKey.trim();
      const resp = await fetch("/api/config/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setModelIds([]);
        setMessage({ ok: false, text: data.error || "获取模型目录失败" });
      } else if (!data.models?.length) {
        setModelIds([]);
        setMessage({ ok: false, text: "该端点未返回任何模型，可直接手动输入模型 ID" });
      } else {
        setModelIds(data.models);
        setShowCatalog(false);
        setMessage({ ok: true, text: `已获取 ${data.models.length} 个模型（点击右侧箭头展开目录）` });
      }
    } catch {
      setMessage({ ok: false, text: "网络错误，无法获取模型目录" });
    } finally {
      setFetchingModels(false);
    }
  };

  const toggleCatalog = () => {
    if (showCatalog) {
      setShowCatalog(false);
      return;
    }
    const modal = modalRef.current;
    const anchor = anchorRef.current;
    if (!modal || !anchor) {
      setShowCatalog(true);
      return;
    }
    // 浮层锚定输入框位置；下方空间不足（弹窗底栏+内边距）则向上翻
    const mr = modal.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const below = mr.height - (ar.bottom - mr.top) - 12;
    const above = ar.top - mr.top - 12;
    const flipUp = below < 180 && above > below;
    const space = flipUp ? above : below;
    const maxHeight = Math.min(288, Math.max(96, space));
    const top = flipUp
      ? Math.max(8, ar.top - mr.top - maxHeight - 6)
      : Math.min(ar.bottom - mr.top + 6, mr.height - maxHeight - 8);
    setCatalogPos({ left: ar.left - mr.left, top, width: ar.width, maxHeight });
    setShowCatalog(true);
  };

  return (
    <div
      className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="relative bg-[#FDFCF8] rounded-3xl border border-stone-200 shadow-2xl w-[860px] max-w-full h-[580px] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => {
          e.stopPropagation();
          setShowCatalog(false);
        }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-100 flex-shrink-0">
          <h2 className="font-black text-stone-800 text-lg">设置</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-stone-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex">
            {/* 左侧栏目导航 */}
            <nav className="w-52 flex-shrink-0 bg-stone-50/60 border-r border-stone-100 p-3 space-y-1">
              {SECTIONS.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setSection(item.id)}
                    className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      active
                        ? "bg-white text-stone-800 shadow-sm"
                        : "text-stone-500 hover:bg-white/60 hover:text-stone-700"
                    }`}
                  >
                    <Icon className={`w-[18px] h-[18px] stroke-[1.5] ${active ? "text-emerald-500" : "text-stone-400"}`} />
                    {item.label}
                  </button>
                );
              })}
            </nav>

            {/* 右侧内容区 */}
            <div className="flex-1 min-w-0 flex flex-col">
              <div className="flex-1 overflow-y-auto p-8" onScroll={() => setShowCatalog(false)}>
                <div className="max-w-lg space-y-5">
                  {section === "model" ? (
                    <>
                      {/* API 地址 */}
                      <div className="space-y-2">
                        <label className={labelCls}>API 地址</label>
                        <input
                          type="text"
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder={apiProtocol === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.example.com/v1"}
                          className={inputCls}
                        />
                      </div>

                      {/* API 协议 */}
                      <div className="space-y-2">
                        <label className={labelCls}>API 协议</label>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setShowProtocolMenu((v) => !v)}
                            className={`${inputCls} flex items-center justify-between text-left`}
                          >
                            <span>{PROTOCOLS.find((p) => p.id === apiProtocol)?.label}</span>
                            <ChevronDown className="w-4 h-4 text-stone-400" />
                          </button>
                          {showProtocolMenu && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setShowProtocolMenu(false)} />
                              <div className="absolute z-20 mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg overflow-hidden">
                                {PROTOCOLS.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onMouseDown={() => {
                                      setApiProtocol(p.id);
                                      setShowProtocolMenu(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 text-sm font-bold hover:bg-emerald-50 transition-colors ${
                                      p.id === apiProtocol ? "text-emerald-600 bg-emerald-50" : "text-stone-700"
                                    }`}
                                  >
                                    {p.label}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* API 密钥 */}
                      <div className="space-y-2">
                        <label className={labelCls}>
                          API 密钥{keyMasked && <span className="ml-2 normal-case font-bold text-stone-400">当前: {keyMasked}</span>}
                        </label>
                        <div className="relative">
                          <input
                            type={showKey ? "text" : "password"}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder={keyMasked ? "留空则保留现有 Key" : "输入 API 密钥"}
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
                        <p className="text-[11px] text-stone-400 font-medium">
                          密钥保存在本机后端 config.json，不会上传到任何第三方。
                        </p>
                      </div>

                      {/* 模型目录 */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className={labelCls}>模型目录</label>
                          <button
                            type="button"
                            onClick={fetchModels}
                            disabled={fetchingModels || !baseUrl.trim()}
                            className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700 disabled:opacity-50 transition-colors"
                          >
                            {fetchingModels && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            获取可用模型
                          </button>
                        </div>
                        <div className="relative" ref={anchorRef}>
                          <input
                            type="text"
                            value={modelName}
                            onChange={(e) => setModelName(e.target.value)}
                            placeholder="模型 ID，如 glm-5.3-flash"
                            className={`${inputCls} ${modelIds.length > 0 ? "pr-10" : ""}`}
                          />
                          {modelIds.length > 0 && (
                            <button
                              type="button"
                              aria-label={showCatalog ? "收起模型目录" : "展开模型目录"}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCatalog();
                              }}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors"
                            >
                              <ChevronDown className={`w-4 h-4 transition-transform duration-150 ${showCatalog ? "rotate-180" : ""}`} />
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-stone-400 font-medium">
                          {modelIds.length > 0
                            ? "点击右侧箭头展开模型目录，选中即填入，也可直接手动输入模型 ID。"
                            : "点击「获取可用模型」拉取目录；未获取时可直接手动输入模型 ID。"}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* 题目分类路由 */}
                      <div className="space-y-2">
                        <label className={labelCls}>题目分类路由</label>
                        <div className="flex gap-1 bg-stone-100 p-1 rounded-full border border-stone-200">
                          {(
                            [
                              { id: "llm", label: "LLM 分类" },
                              { id: "decisions", label: "决策模型" },
                            ] as const
                          ).map((item) => (
                            <button
                              key={item.id}
                              onClick={() => setRouterMode(item.id)}
                              className={`flex-1 py-2 rounded-full text-sm font-bold transition-all ${
                                routerMode === item.id
                                  ? "bg-white text-emerald-600 shadow-sm"
                                  : "text-stone-400 hover:text-stone-600"
                              }`}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {routerMode === "decisions" ? (
                        <>
                          <div className="space-y-2">
                            <label className={labelCls}>
                              Perplexity API Key{pplxKeyMasked && <span className="ml-2 normal-case font-bold text-stone-400">当前: {pplxKeyMasked}</span>}
                            </label>
                            <input
                              type="password"
                              value={pplxKey}
                              onChange={(e) => setPplxKey(e.target.value)}
                              placeholder={pplxKeyMasked ? "留空则保留现有 Key" : "粘贴 Perplexity API Key"}
                              className={inputCls}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className={labelCls}>置信度阈值（低于则回退 LLM 分类）</label>
                            <input
                              type="text"
                              value={threshold}
                              onChange={(e) => setThreshold(e.target.value)}
                              placeholder="0.8"
                              className={inputCls}
                            />
                          </div>
                          <p className="text-[11px] text-stone-400 font-medium">
                            决策模型（pplx-decider-v1-27b）直接返回分类概率与置信度；调用失败或置信度低于阈值时自动回退 LLM 分类。
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-stone-400 font-medium">
                          用当前配置的对话模型分类题目（一次调用，输出 A/B/C/D）。
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 底部操作条 */}
              <div className="flex-shrink-0 border-t border-stone-100 px-8 py-4 flex items-center justify-end gap-4">
                {message && (
                  <div
                    className={`flex items-center gap-2 text-sm font-bold mr-auto ${
                      message.ok ? "text-emerald-600" : "text-red-500"
                    }`}
                  >
                    {message.ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                    {message.text}
                  </div>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white font-bold px-8 py-2.5 rounded-full transition-all active:scale-[0.98] shadow-sm flex items-center gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  保存配置
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 模型目录浮层：锚定输入框位置、空间不足自动向上翻；挂在弹窗根节点上，
            不占文档流（滚动区长度与收起时完全一致）、不被内容滚动容器裁剪。 */}
        {showCatalog && catalogPos && modelIds.length > 0 && (
          <div
            className="absolute z-40 overflow-y-auto bg-white border border-stone-200 rounded-xl shadow-xl"
            style={{ left: catalogPos.left, top: catalogPos.top, width: catalogPos.width, maxHeight: catalogPos.maxHeight }}
          >
            {modelIds.map((id) => (
              <button
                key={id}
                type="button"
                onMouseDown={() => {
                  setModelName(id);
                  setShowCatalog(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm font-bold hover:bg-emerald-50 transition-colors ${
                  id === modelName ? "text-emerald-600 bg-emerald-50" : "text-stone-700"
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
