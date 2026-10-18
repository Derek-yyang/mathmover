/**
 * 「画布渲染异常」的痕迹通道 —— 白帧、上下文丢失这类问题的**现场取证**。
 *
 * 为什么要有这个模块：这类故障是「用户看得见、我们看不见」——只在某个浏览器/某次冷启动下
 * 复现，DevTools 没开着就什么都不剩。所以落一条持久痕迹：localStorage（只留最近 10 条）
 * 加 `window.__mmRenderTrouble`，复现后一行读出：
 *
 *   JSON.parse(localStorage.getItem('mm:render-trouble') || '[]')
 *
 * 写入方：`lib/ggb-bridge.ts`（WebGL 上下文丢失/恢复）与 `hooks/useGgbSession.ts`
 *（3D 视图等到超时仍没就绪）。故意独立成小模块——大模块（如整个桥）不该被 hook 反向依赖。
 */
export function noteRenderTrouble(event: string, extra: Record<string, unknown> = {}): void {
  const entry = { at: new Date().toISOString(), event, ...extra };
  try {
    const key = 'mm:render-trouble';
    const previous = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[];
    localStorage.setItem(key, JSON.stringify([...previous.slice(-9), entry]));
  } catch { /* 存不下就算了，console 那条还在 */ }
  (window as unknown as Record<string, unknown>).__mmRenderTrouble = entry;
  console.warn('[mathmover] 画布渲染异常:', entry);
}
