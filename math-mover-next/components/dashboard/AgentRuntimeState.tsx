'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { RuntimeOption } from './AgentChatPanel';
import { agentFailure, agentResponseError, type AgentDiagnostic } from '@/lib/agent-diagnostics';
import { purgeLegacyByokKey } from '@/lib/byok-config';

interface AgentRuntimeState {
  runtimes: RuntimeOption[];
  activeRuntimeId?: string;
  detecting: boolean;
  detectionError: AgentDiagnostic | null;
  runtimeFailures: ReadonlyMap<string | undefined, AgentDiagnostic>;
  recordFailure: (diagnostic: AgentDiagnostic) => void;
  clearFailure: (runtimeId?: string) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  selectRuntime: (id: string) => void;
  refreshRuntimes: (options?: { fresh?: boolean }) => Promise<void>;
  /** Apply canonical metadata returned by a configuration save without detection. */
  updateRuntime: (runtime: RuntimeOption) => void;
  /** 当前 agent 的模型选择。聊天区 composer 选择器与设置卡片写同一份状态。 */
  selectedModel: string;
  /** 当前「agent + 模型」的推理档位；undefined = 用 agent 配置的默认档。 */
  selectedEffort: string | undefined;
  selectModel: (id: string) => void;
  selectEffort: (id: string) => void;
  /** Settings can edit BYOK without changing the active third-party Agent. */
  selectModelFor: (agentId: string, modelId: string) => void;
  selectEffortFor: (agentId: string, modelId: string, effortId: string | undefined) => void;
  /** 某 agent 当前的模型 id（设置卡片「一眼可见」用，不要求它是活跃 agent） */
  modelFor: (agentId: string) => string;
  /** 某「agent + 模型」当前的档位 id（undefined = 默认档） */
  effortFor: (agentId: string, modelId: string) => string | undefined;
}

const AgentRuntimeContext = createContext<AgentRuntimeState | null>(null);

export function AgentRuntimeProvider({ children }: { children: ReactNode }) {
  const [runtimes, setRuntimes] = useState<RuntimeOption[]>([]);
  const [activeRuntimeId, setActiveRuntimeId] = useState<string>();
  const [detecting, setDetecting] = useState(true);
  const [detectionError, setDetectionError] = useState<AgentDiagnostic | null>(null);
  const [runtimeFailures, setRuntimeFailures] = useState<Map<string | undefined, AgentDiagnostic>>(() => new Map());
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const runtimeUpdates = useRef(new Map<string, RuntimeOption>());

  // fresh（默认）= 强制重探——「刷新检测」按钮的语义；初始加载传 { fresh: false }
  // 吃服务端 60 秒缓存，页面反复打开不再等一轮 CLI 冷启动。
  const refreshRuntimes = useCallback(async (options?: { fresh?: boolean }) => {
    pending.current?.abort();
    const controller = new AbortController();
    const updatesAtStart = new Map(runtimeUpdates.current);
    pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 30000);
    setDetecting(true);
    setDetectionError(null);
    try {
      const response = await fetch(options?.fresh === false ? '/api/agent' : '/api/agent?fresh=1', { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}：${agentResponseError(await response.text())}`);
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.runtimes) || data.runtimes.some((item: RuntimeOption) =>
        !item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.usable !== 'boolean' || (item.version !== null && typeof item.version !== 'string'))) {
        throw new Error('检测服务返回的 Agent 列表格式无效。');
      }
      if (controller.signal.aborted) return;
      // A detection started before a save must not restore old credentials/models.
      // Other Agents can still finish detecting normally.
      const list: RuntimeOption[] = data.runtimes;
      for (const [id, runtime] of runtimeUpdates.current) {
        if (updatesAtStart.get(id) === runtime) continue;
        const index = list.findIndex(item => item.id === id);
        if (index < 0) list.push(runtime);
        else list[index] = runtime;
      }
      setRuntimes(list);
      // 已选 Agent 检测失败也不静默切换；只为首次进入选默认值。
      setActiveRuntimeId(previous => previous ?? list.find(item => item.usable)?.id ?? list[0]?.id);
    } catch (error) {
      if (pending.current === controller) setDetectionError(agentFailure({
        stage: 'detect', message: controller.signal.aborted ? '检测等待超过 30 秒。' : error instanceof Error ? error.message : String(error),
      }));
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) setDetecting(false);
    }
  }, []);

  useEffect(() => {
    try { setActiveRuntimeId(localStorage.getItem('mm.agentId') || undefined); } catch {}
    purgeLegacyByokKey();   // localStorage 时代的 BYOK 残键（可能含 key 本体）进台即清
    void refreshRuntimes({ fresh: false });
    return () => { pending.current?.abort(); pending.current = null; };
  }, [refreshRuntimes]);

  const updateRuntime = useCallback((runtime: RuntimeOption) => {
    runtimeUpdates.current.set(runtime.id, runtime);
    setRuntimes(previous => previous.some(item => item.id === runtime.id)
      ? previous.map(item => item.id === runtime.id ? runtime : item)
      : [...previous, runtime]);
  }, []);

  const selectRuntime = useCallback((id: string) => {
    if (busy || !runtimes.some(item => item.id === id && item.usable)) return;
    setActiveRuntimeId(id);
    try { localStorage.setItem('mm.agentId', id); } catch {}
  }, [busy, runtimes]);

  const recordFailure = useCallback((diagnostic: AgentDiagnostic) => {
    setRuntimeFailures(previous => new Map(previous).set(diagnostic.runtimeId, diagnostic));
  }, []);
  const clearFailure = useCallback((runtimeId?: string) => {
    setRuntimeFailures(previous => {
      if (!previous.has(runtimeId)) return previous;
      const next = new Map(previous);
      next.delete(runtimeId);
      return next;
    });
  }, []);

  // 模型选择按 agent 分别记（localStorage 键与历史一致）。**不进课件记录**——
  // 模型是「怎么跑」，不是「跑出了什么」；跟着课件走会让历史课件语义混乱。
  const [modelByAgent, setModelByAgent] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('mathmover_model_by_agent') ?? '{}') as Record<string, string>; }
    catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem('mathmover_model_by_agent', JSON.stringify(modelByAgent)); } catch { /* 隐私模式等，丢选择不影响使用 */ }
  }, [modelByAgent]);
  const selectedModel = (activeRuntimeId && modelByAgent[activeRuntimeId]) || 'default';
  const selectModelFor = useCallback((agentId: string, modelId: string) => {
    setModelByAgent(prev => ({ ...prev, [agentId]: modelId }));
  }, []);
  const selectModel = useCallback((id: string) => {
    if (!activeRuntimeId) return;
    selectModelFor(activeRuntimeId, id);
  }, [activeRuntimeId, selectModelFor]);

  // 推理档位按「agent + 模型」记：换个模型档位集就变了，不能跟着 agent 走。
  // 用 JSON 一层套娃当 key，避免 `agent/model` 里的斜杠歧义。
  const effortKey = JSON.stringify([activeRuntimeId ?? '', selectedModel]);
  const [effortByModel, setEffortByModel] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('mathmover_effort_by_model') ?? '{}') as Record<string, string>; }
    catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem('mathmover_effort_by_model', JSON.stringify(effortByModel)); } catch { /* 隐私模式等 */ }
  }, [effortByModel]);
  const selectedEffort = effortByModel[effortKey];
  const selectEffortFor = useCallback((agentId: string, modelId: string, effortId: string | undefined) => {
    setEffortByModel(prev => {
      const key = JSON.stringify([agentId, modelId]);
      if (effortId !== undefined) return { ...prev, [key]: effortId };
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);
  const selectEffort = useCallback((id: string) => {
    selectEffortFor(activeRuntimeId ?? '', selectedModel, id);
  }, [activeRuntimeId, selectedModel, selectEffortFor]);

  const modelFor = useCallback((agentId: string) => modelByAgent[agentId] || 'default', [modelByAgent]);
  const effortFor = useCallback(
    (agentId: string, modelId: string) => effortByModel[JSON.stringify([agentId, modelId])],
    [effortByModel],
  );

  return <AgentRuntimeContext.Provider value={{ runtimes, activeRuntimeId, detecting, detectionError, runtimeFailures, recordFailure, clearFailure, busy, setBusy, selectRuntime, refreshRuntimes, updateRuntime, selectedModel, selectedEffort, selectModel, selectEffort, selectModelFor, selectEffortFor, modelFor, effortFor }}>
    {children}
  </AgentRuntimeContext.Provider>;
}

export function useAgentRuntimeState() {
  const state = useContext(AgentRuntimeContext);
  if (!state) throw new Error('AgentRuntimeProvider is required');
  return state;
}
