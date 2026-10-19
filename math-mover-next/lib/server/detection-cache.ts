/**
 * 运行时探测结果的进程内缓存。
 *
 * 为什么要缓存：一轮探测含三条 CLI 的冷启动 + 模型清单，整轮 ~10s；页面反复打开
 * 不该每次都等它。「刷新检测」走 `?fresh=1` 绕开。
 *
 * 为什么要**能作废**：配置一变（端点/模型/档位），清单就旧了。不作废的话，
 * 保存完 60 秒内重开页面还会看到旧值——用户 2026-10-18 报的「保存了但对话区没更新」
 * 一半是这个，另一半是前端拿一次就不再取（见 AgentRuntimeState.patchRuntime）。
 */
export interface DetectedRuntime {
  id: string;
  name: string;
  version: string | null;
  usable: boolean;
  versionWarning?: string;
  authStatus?: string;
  authMessage?: string;
  canAttachImages: boolean;
  models?: {
    list: Array<{ id: string; label: string; reasoningOptions?: Array<{ id: string; label: string; default?: boolean }> }>;
    source: string;
  };
}

const TTL_MS = 60_000;
let cache: { at: number; runtimes: DetectedRuntime[] } | null = null;

/** 缓存可用（未过期）时返回它，否则 null。 */
export function readFreshDetectionCache(now = Date.now()): DetectedRuntime[] | null {
  return cache && now - cache.at <= TTL_MS ? cache.runtimes : null;
}

export function writeDetectionCache(runtimes: DetectedRuntime[]): void {
  cache = { at: Date.now(), runtimes };
}

/** 配置变了就调用它——别让用户保存完还看到旧清单。 */
export function invalidateDetectionCache(): void {
  cache = null;
}
