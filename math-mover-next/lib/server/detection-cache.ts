/**
 * 运行时探测结果的进程内缓存。
 *
 * 为什么要缓存：一轮探测含三条 CLI 的冷启动 + 模型清单，整轮 ~10s；页面反复打开
 * 不该每次都等它。「刷新检测」走 `?fresh=1` 绕开。
 *
 * 配置变动只更新内置 Agent 条目，不延长其他 Agent 的缓存有效期；
 * 显式刷新仍重新探测全部运行时。
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

/** Reuse the last known model catalog on save, even if full detection is due again. */
export function readCachedRuntime(id: string): DetectedRuntime | undefined {
  return cache?.runtimes.find(item => item.id === id);
}

export function updateCachedRuntime(runtime: DetectedRuntime): void {
  if (!cache) return;
  cache.runtimes = [...cache.runtimes.filter(item => item.id !== runtime.id), runtime];
}

/** 配置变了就调用它——别让用户保存完还看到旧清单。 */
export function invalidateDetectionCache(): void {
  cache = null;
}
