/**
 * 页面侧 GGB 桥 —— 把活画布的原始能力暴露给外部工具。
 *
 * 设计原则（刻意薄）：这里**只做原始访问**，不做体检/解析/diff 等智能。
 * 智能留在 daemon（packages/daemon），由它调 @mathmover/ggb-core 组装结构。
 * 好处：math-mover-next 不必跨包依赖 workspace，页面保持可独立运行的 web 形态。
 *
 * 两个通道：
 *   ① window.__mmGgb  —— 同进程/无头浏览器可直接调（Playwright、Electron 隐藏窗口）
 *   ② WebSocket      —— 本地 daemon 反向调用（agent 那一侧）
 *
 * 只绑 127.0.0.1 的 daemon；工作台通过同源接口获取一次性窗口绑定票据。
 */

import type { GeoGebraApi } from '@/components/dashboard/types';
// 页面侧与 daemon 共用同一份原始状态契约。只走 /types 子路径，不从整包引
// （barrel 会把 sop/whitelist 连同 node:fs 拖进浏览器产物）。
import type { RawState, RawApplyResult } from '@mathmover/ggb-core/types';

/** 页面持有的账本：真源。派生视图由 daemon 现场重算。 */

interface Bridge {
  version: 1;
  ping(): boolean;
  getState(): Promise<RawState>;
  apply(commands: string[]): Promise<RawApplyResult>;
  reset(): void;
  setLedger(commands: string[]): void;
}

const BRIDGE_KEY = '__mmGgb';

/**
 * 等画布真正画完再取图。
 *
 * 为什么要等：GeoGebra 的 `evalCommand` 是同步的，但**绘制是异步的**。
 * 命令刚执行完就 `toDataURL()`，拿到的可能是还没画上对象的空白坐标系——
 * 实测中 agent 就收到过这样的空图，误以为"几何对象没被画进导出图"。
 *
 * ⚠ 但**绝不能只等 rAF**：后台标签页/无头浏览器里 requestAnimationFrame
 * 可能永不触发，"等绘制"会变成"等死"（实测把 apply 拖到 60s 超时）。
 * 所以 rAF 与硬超时**竞速**：先到者取胜，等待时间有上界。
 */
async function settlePaint(): Promise<void> {
  const RACE_LIMIT_MS = 300;

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      requestAnimationFrame(() => requestAnimationFrame(done));
    } catch {
      done();
    }
    // 硬上界：无论 rAF 是否触发，最多等 RACE_LIMIT_MS
    setTimeout(done, RACE_LIMIT_MS);
  });

  // 再补一个短延时，兜住软渲染下更慢的合成
  await new Promise<void>((r) => setTimeout(r, 120));
}

/** 画布取图：优先直接读 canvas 像素（网页/Electron 同一行代码）。 */
function capturePng(api: GeoGebraApi): { png: string | null; source: RawState['pngSource'] } {
  void api;
  try {
    // GeoGebra 容器 id 在不同宿主下不同：e2e harness 用 #ggb，真实页面是 #ggb-element
    // （或 CanvasStage/GeoGebraBoard 传入的自定义 id）。所以多选择器 + 回退到最大 canvas。
    const candidates = [
      document.querySelector('#ggb canvas'),
      document.querySelector('#ggb-element canvas'),
      document.querySelector('.GeoGebraFrame canvas'),
      document.querySelector('.appletParameters canvas'),
    ].filter(Boolean) as HTMLCanvasElement[];

    if (candidates.length === 0) {
      // 最后手段：全页最大的 canvas（GGB 的视图面通常就是最大那块）
      const all = [...document.querySelectorAll('canvas')] as HTMLCanvasElement[];
      all.sort((a, b) => b.width * b.height - a.width * a.height);
      if (all[0]) candidates.push(all[0]);
    }

    for (const canvas of candidates) {
      if (typeof canvas.toDataURL !== 'function') continue;
      const url = canvas.toDataURL('image/png');
      // 空 canvas 会给出极短的 dataURL；极小的 canvas 也不该当画布
      if (url && url.length > 100 && canvas.width > 100 && canvas.height > 100) {
        return { png: url.slice(url.indexOf(',') + 1), source: 'canvas-to-data-url' };
      }
    }
  } catch {
    // fallthrough
  }
  // 备胎：整页截屏由宿主提供（Electron webContents.capturePage / Playwright screenshot）。
  // 页面内拿不到，这里只能如实报 none，由 daemon 决定是否降级。
  void api;
  return { png: null, source: 'none' };
}

/**
 * 采集派生视图。**取图前必须等画布绘制完成**——否则会拍到空白坐标系。
 */
async function collectState(
  api: GeoGebraApi,
  ledger: string[],
  generation: number,
): Promise<RawState> {
  const names = (() => {
    try {
      return (api.getAllObjectNames?.() as string[]) || [];
    } catch {
      return [];
    }
  })();

  const objects: RawState['objects'] = {};
  const sliders: RawState['sliders'] = [];
  for (const name of names) {
    let type = '?';
    let value: string | null = null;
    let independent = false;
    try { type = api.getObjectType?.(name) ?? '?'; } catch {}
    try { value = api.getValueString?.(name) ?? null; } catch {}
    try { independent = api.isIndependent?.(name) ?? false; } catch {}
    objects[name] = { type, value, independent };
    if (type === 'numeric' && independent) {
      let v = Number.NaN;
      try { v = api.getValue?.(name) ?? Number.NaN; } catch {}
      sliders.push({ name, value: v });
    }
  }

  await settlePaint();

  const { png, source } = capturePng(api);
  return { commands: [...ledger], names, objects, sliders, png, pngSource: source, generation };
}

/**
 * 挂载桥。在 appletOnLoad 之后调用一次。
 *
 * @param api    GeoGebra api 实例
 * @param opts.getLedger       当前账本的读取函数（通常接 useGgbSession 的 lastExecutedCommands）
 * @param opts.onLedgerChange  账本变更通知
 * @param opts.applyCommands   **执行器委托**。传入后回放走它，而不是桥自带的实现。
 *   为什么要这个：宿主（如 dashboard）的业务状态挂在 useGgbSession 里（滑块、账本、体检），
 *   若桥自己直接 evalCommand，两条执行路径会打架、状态不同步。
 *   把执行委托给宿主既有路径，状态才保持单一来源。
 * @param opts.wsUrl           可选，daemon 的 WebSocket 地址（默认 ws://127.0.0.1:8787）
 */
export function attachGgbBridge(
  api: GeoGebraApi,
  opts: {
    getLedger: () => string[];
    onLedgerChange?: (commands: string[]) => void;
    applyCommands?: (commands: string[]) => Promise<{
      applied: string[];
      failedFirstPass: string[];
    }>;
    wsUrl?: string;
    windowId?: string;
  },
): () => void {
  let generation = 0;

  const bridge: Bridge = {
    version: 1,
    ping: () => true,
    getState: () => collectState(api, opts.getLedger(), generation),
    apply: async (commands: string[]) => {
      const t0 = performance.now();
      let applied: string[] = [];
      let failedFirstPass: string[] = [];

      if (opts.applyCommands) {
        // 委托给宿主既有的执行路径（保持业务状态单一来源）
        const r = await opts.applyCommands(commands);
        applied = r.applied;
        failedFirstPass = r.failedFirstPass;
      } else {
        // 桥自带的最小实现（无宿主时兜底）
        try { api.newConstruction(); } catch {}
        try {
          if (typeof api.setPerspective === 'function') api.setPerspective('G');
          if (typeof api.setAxesVisible === 'function') api.setAxesVisible(true, true);
          if (typeof api.setGridVisible === 'function') api.setGridVisible(true);
        } catch {}

        /**
         * ⚠「假失败」陷阱（2026-10-09 实测）：
         * `evalCommand('SetColor(f, "#FF0000")')` **返回 false，但颜色真的设上了**。
         * 属性类指令（Set* / Show*）成功时也返回 false——与定义行的语义相反。
         * 若拿返回值当成败判据，会把颜色/线宽/标签当成失败剔掉。
         * 属性行只以「是否抛异常」判失败。（case-01「假成功」的镜像。）
         */
        const isPropertyLine = (line: string) =>
          /^\s*(?:Set\w+|Show\w+|SetColor|SetFilling|SetLineThickness|SetPointStyle|SetCaption|SetVisible|SetTrace|SetTooltip)\s*\(/.test(line);

        for (const raw of commands) {
          const line = raw.trim();
          if (!line || line.startsWith('//') || line.startsWith('MODE:')) continue;
          const clean = line.replace(/\\"/g, '"');
          try {
            const ok = api.evalCommand(clean);
            if (ok === false && !isPropertyLine(line)) failedFirstPass.push(line);
            else applied.push(line);
          } catch {
            failedFirstPass.push(line);
          }
        }

        if (failedFirstPass.length > 0) {
          await new Promise((r) => setTimeout(r, 300));
          for (const line of [...failedFirstPass]) {
            try {
              const ok = api.evalCommand(line.replace(/\\"/g, '"'));
              if (ok !== false) {
                failedFirstPass.splice(failedFirstPass.indexOf(line), 1);
                applied.push(line);
              }
            } catch {}
          }
        }

        try {
          api.refreshViews?.();
          api.recalcDisplay?.();
        } catch {}
      }

      generation += 1;
      opts.onLedgerChange?.(commands);

      return {
        applied,
        failedFirstPass,
        durationMs: Math.round(performance.now() - t0),
        state: await collectState(api, commands, generation),
      };
    },
    reset: () => {
      try { api.newConstruction(); } catch {}
      generation += 1;
      opts.onLedgerChange?.([]);
    },
    setLedger: (commands) => {
      generation += 1;
      opts.onLedgerChange?.(commands);
    },
  };

  (window as unknown as Record<string, unknown>)[BRIDGE_KEY] = bridge;

  // —— WebSocket 通道：daemon 反向调用 ——
  let ws: WebSocket | null = null;
  let closed = false;

  const connect = async () => {
    if (closed) return;
    let bindingToken: string | undefined;
    try {
      if (opts.windowId) {
        const response = await fetch('/api/coursewares/windows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ windowId: opts.windowId }) });
        if (!response.ok) throw new Error('窗口绑定失败');
        bindingToken = (await response.json()).bindingToken;
        if (closed) return;
      }
      ws = new WebSocket(opts.wsUrl ?? 'ws://127.0.0.1:8787');
    } catch {
      setTimeout(connect, 2000);
      return;
    }
    const socket = ws;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'hello', version: 1, windowId: opts.windowId, bindingToken }));
    };
    socket.onmessage = async (ev) => {
      let msg: { id?: string; op?: string; args?: unknown } = {};
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (!msg.id || !msg.op) return;

      const reply = (payload: unknown) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: msg.id, payload })); };
      const fail = (error: string) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: msg.id, error })); };

      try {
        switch (msg.op) {
          case 'ping':
            reply(true);
            break;
          case 'getState':
            reply(await bridge.getState());
            break;
          case 'apply':
            reply(await bridge.apply((msg.args as { commands: string[] })?.commands ?? []));
            break;
          case 'reset':
            bridge.reset();
            reply(true);
            break;
          default:
            fail(`未知操作: ${msg.op}`);
        }
      } catch (e) {
        fail(String(e instanceof Error ? e.message : e));
      }
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      if (!closed) setTimeout(connect, 2000); // 自动重连
    };
    socket.onerror = () => socket.close();
  };
  connect();

  return () => {
    closed = true;
    ws?.close();
    delete (window as unknown as Record<string, unknown>)[BRIDGE_KEY];
  };
}
