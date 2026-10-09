import runtime from '../geogebra-runtime.json';

const base = `/vendor/geogebra/${runtime.version}/`;
export const GGB_SCRIPT = `${base}deployggb.js`;
// 官方 ZIP 的内部目录仍叫 5.0；它与实际引擎版本不是一回事。
export const GGB_CODEBASE = `${base}${runtime.codebase}`;

/** 仅加载本地运行库；失败可重试，不回退到外部 CDN。 */
export function ensureGGBLoaded(): Promise<void> {
  if (typeof window === 'undefined' || window.GGBApplet) return Promise.resolve();
  if (window.__GGB_LOAD_PROMISE__) return window.__GGB_LOAD_PROMISE__;

  const script = document.createElement('script');
  script.src = GGB_SCRIPT;
  script.async = true;
  const pending = new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => fail(), 20_000);
    const fail = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      script.remove();
      window.__GGB_LOAD_PROMISE__ = undefined;
      reject(new Error('本地 GeoGebra 运行库加载失败，请检查安装资源。'));
    };
    script.onload = () => {
      window.clearTimeout(timer);
      if (!window.GGBApplet) { fail(); return; }
      settled = true;
      script.onload = null;
      script.onerror = null;
      resolve();
    };
    script.onerror = fail;
  });
  window.__GGB_LOAD_PROMISE__ = pending;
  document.body.appendChild(script);
  return pending;
}
