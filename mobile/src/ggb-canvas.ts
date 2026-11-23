import { ensureGGBLoaded, GGB_CODEBASE } from '@/lib/ggb-runtime';
import { attachGgbBridge } from '@/lib/ggb-bridge';

type GgbApi = any;

export interface GgbCanvas {
  getState: () => Promise<any>;
  apply: (commands: string[], incremental?: boolean) => Promise<any>;
  reset: () => void;
}

export async function createGgbCanvas(container: HTMLElement): Promise<GgbCanvas> {
  await ensureGGBLoaded();

  const id = `ggb-${crypto.randomUUID()}`;
  container.id = id;

  const api = await new Promise<GgbApi>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('GeoGebra 加载超时')), 20000);
    const params = {
      id,
      appName: 'classic',
      perspective: '2',
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      showToolBar: false,
      showAlgebraInput: false,
      showMenuBar: false,
      enableShiftDragZoom: true,
      enableRightClick: false,
      enableLabelDrags: true,
      showResetIcon: false,
      showAxes: true,
      showGrid: true,
      errorDialogsActive: false,
      useBrowserForScale: false,
      disableAutoScale: true,
      appletOnLoad: (value: GgbApi) => {
        window.clearTimeout(timer);
        resolve(value);
      },
    };
    const applet = new (window as any).GGBApplet(params, true);
    // 移动端先走 2D codebase；4.x/5.x 的 web3d 在部分 WebView 上会渲染空白。
    applet.setHTML5Codebase(GGB_CODEBASE.replace(/web3d\/$/, 'web/'), true);
    container.replaceChildren();
    applet.inject(container);
  });

  api.setSize?.(container.clientWidth, container.clientHeight);
  api.setAxesVisible?.(true, true);
  api.setGridVisible?.(true);

  // 全屏画布、键盘弹出、旋转都需要把尺寸同步给 GeoGebra。
  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    api.setSize?.(width, height);
  });
  resizeObserver.observe(container);

  let ledger: string[] = [];
  let request: ((op: string, args?: unknown) => Promise<unknown>) | null = null;
  attachGgbBridge(api, {
    getLedger: () => ledger,
    onLedgerChange: commands => { ledger = commands; },
    canvasRoot: container,
    // 移动端不需要连本机 daemon；用 transport 拿到同一份 bridge 调度器。
    transport: bridgeRequest => {
      request = bridgeRequest;
      return { close: () => {}, reconnect: () => {} };
    },
  });

  const call = <T>(op: string, args?: unknown): Promise<T> => {
    if (!request) return Promise.reject(new Error('GGB bridge not ready'));
    return request(op, args) as Promise<T>;
  };

  return {
    getState: () => call('getState'),
    apply: (commands, incremental = false) => call('apply', {
      commands,
      incremental,
      // 增量时账本仍是完整清单；非增量时整份替换。
      ledger: incremental ? [...ledger, ...commands] : commands,
    }),
    reset: () => { void call('reset'); },
  };
}
