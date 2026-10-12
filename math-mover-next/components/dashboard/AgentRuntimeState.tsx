'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { RuntimeOption } from './AgentChatPanel';
import { agentFailure, agentResponseError, type AgentDiagnostic } from '@/lib/agent-diagnostics';

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
  refreshRuntimes: () => Promise<void>;
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

  // fresh（默认）= 强制重探——「刷新检测」按钮的语义；初始加载传 { fresh: false }
  // 吃服务端 60 秒缓存，页面反复打开不再等一轮 CLI 冷启动。
  const refreshRuntimes = useCallback(async (options?: { fresh?: boolean }) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
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
      const list: RuntimeOption[] = data.runtimes;
      setRuntimes(list);
      // 已选 Agent 检测失败也不静默切换；只为首次进入选默认值。
      setActiveRuntimeId(previous => previous ?? list.find(item => item.usable)?.id ?? list[0]?.id);
    } catch (error) {
      if (pending.current === controller) setDetectionError(agentFailure({
        stage: 'detect', message: controller.signal.aborted ? '检测等待超过 20 秒。' : error instanceof Error ? error.message : String(error),
      }));
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) setDetecting(false);
    }
  }, []);

  useEffect(() => {
    try { setActiveRuntimeId(localStorage.getItem('mm.agentId') || undefined); } catch {}
    void refreshRuntimes({ fresh: false });
    return () => { pending.current?.abort(); pending.current = null; };
  }, [refreshRuntimes]);

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

  return <AgentRuntimeContext.Provider value={{ runtimes, activeRuntimeId, detecting, detectionError, runtimeFailures, recordFailure, clearFailure, busy, setBusy, selectRuntime, refreshRuntimes }}>
    {children}
  </AgentRuntimeContext.Provider>;
}

export function useAgentRuntimeState() {
  const state = useContext(AgentRuntimeContext);
  if (!state) throw new Error('AgentRuntimeProvider is required');
  return state;
}
