export const STALE_EXPORT_PANEL = '当前画板面板还是旧版，请在 WorkBuddy 的 MCP 设置中重新启用 MathMover，再关闭并重新打开画板。';

export async function checkExportSupport(timeout = 2000): Promise<'browser' | 'host'> {
  if (window.parent === window) return 'browser';
  await new Promise<void>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'mathmover:export-support-result' || event.data.requestId !== requestId) return;
      cleanup();
      if (event.data.error) reject(new Error(String(event.data.error)));
      else if (event.data.version === 1) resolve();
      else reject(new Error(STALE_EXPORT_PANEL));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(STALE_EXPORT_PANEL)); }, timeout);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'mathmover:export-support', requestId }, '*');
  });
  return 'host';
}
