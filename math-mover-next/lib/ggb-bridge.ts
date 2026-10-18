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
import { connectGgbDaemon, type GgbConnectionStatus } from './ggb-connection';
// 页面侧与 daemon 共用同一份原始状态契约。只走 /types 子路径，不从整包引
// （barrel 会把 sop/whitelist 连同 node:fs 拖进浏览器产物）。
import type { RawState, RawApplyResult } from '@mathmover/ggb-core/types';

/** 页面持有的账本：真源。派生视图由 daemon 现场重算。 */

interface Bridge {
  version: 1;
  ping(): boolean;
  getState(): Promise<RawState>;
  /**
   * @param commands 要执行的行。增量模式下只是**新增行**（页面不清屏）
   * @param incremental true = 不清空画布，把新行叠加上去（对象逐个出现）
   * @param ledger 增量时的**完整**账本（唯一真源）；缺省 = commands
   */
  apply(payload: { commands: string[]; incremental?: boolean; ledger?: string[] }): Promise<RawApplyResult>;
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

/** 画布取图：优先用 GeoGebra 原生导出，回退到 canvas 像素。 */
function capturePng(api: GeoGebraApi): { png: string | null; source: RawState['pngSource'] } {
  // GeoGebra 原生导出：不依赖 canvas 缓冲区，3D 视图也能拿到正确图像。
  if (typeof api?.getPNGBase64 === 'function') {
    try {
      const b64 = api.getPNGBase64(1, false);
      if (b64 && b64.length > 100) return { png: b64, source: 'ggb-export' };
    } catch { /* fallthrough */ }
  }
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
  return { png: null, source: 'none' };
}

/**
 * 盯住画布的 WebGL 上下文。
 *
 * 3D 视图整块变白、而 kernel 里对象都在（`ggb_get_state` 有对象、`getPNGBase64` 却全白）时，
 * 头号嫌疑就是**上下文丢失**：浏览器在显存紧张或驱动重启时回收 WebGL 上下文，画面就没了，
 * GeoGebra 的 kernel 不受影响；再 apply 一次（重绘）往往就回来——实测现场正是这个形状。
 *
 * 凭据要留给现场：`console` 只在 DevTools 开着时才有，所以同时写一条 localStorage 痕迹
 *（`mm:render-trouble`，只留最近 10 条），复现后读这一行即可：
 *   JSON.parse(localStorage.getItem('mm:render-trouble'))
 *
 * `preventDefault()` 是声明「我要这个上下文回来」，不调它浏览器可能不给恢复；
 * 恢复后顺手让 GeoGebra 重绘一帧（不调也无妨，下一次绘制会自己来）。
 */
function watchCanvasContext(api: GeoGebraApi): void {
  const note = (event: string, extra: Record<string, unknown> = {}) => {
    const entry = { at: new Date().toISOString(), event, ...extra };
    try {
      const key = 'mm:render-trouble';
      const previous = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[];
      localStorage.setItem(key, JSON.stringify([...previous.slice(-9), entry]));
    } catch { /* 存不下就算了，console 那条还在 */ }
    (window as unknown as Record<string, unknown>).__mmRenderTrouble = entry;
    console.warn('[mathmover] 画布渲染异常:', entry);
  };

  const attach = () => {
    for (const canvas of document.querySelectorAll('canvas')) {
      const tagged = canvas as HTMLCanvasElement & { __mmContextWatched?: boolean };
      if (tagged.__mmContextWatched) continue;
      tagged.__mmContextWatched = true;
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();   // 声明想要恢复
        note('webgl-context-lost', { canvas: [canvas.width, canvas.height] });
      }, false);
      canvas.addEventListener('webglcontextrestored', () => {
        note('webgl-context-restored');
        try { api.refreshViews?.(); } catch { /* 下一次绘制会自己来 */ }
      }, false);
    }
  };

  attach();
  // 画布可能在 applet 就绪之后才挂上（各视图是懒创建的），隔几拍再补挂
  setTimeout(attach, 2000);
  setTimeout(attach, 6000);
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
    applyCommands?: (payload: { commands: string[]; incremental?: boolean; ledger?: string[] }) => Promise<{
      applied: string[];
      failedFirstPass: string[];
    }>;
    wsUrl?: string;
    windowId?: string;
    onConnectionChange?: (status: GgbConnectionStatus) => void;
  },
) {
  let generation = 0;

  const bridge: Bridge = {
    version: 1,
    ping: () => true,
    getState: () => collectState(api, opts.getLedger(), generation),
    apply: async (payload) => {
      const commands = payload.commands ?? [];
      const incremental = payload.incremental === true;
      // 账本永远是完整清单：增量时页面只执行新行，但真源必须是全量
      const ledger = payload.ledger ?? commands;
      const t0 = performance.now();
      let applied: string[] = [];
      let failedFirstPass: string[] = [];

      if (opts.applyCommands) {
        // 委托给宿主既有的执行路径（保持业务状态单一来源）
        const r = await opts.applyCommands({ commands, incremental, ledger });
        applied = r.applied;
        failedFirstPass = r.failedFirstPass;
      } else {
        // 桥自带的最小实现（无宿主时兜底）
        // 增量模式**不清屏**——新对象直接叠在现有图上，这是「一点点长出来」的关键
        if (!incremental) {
          try { api.newConstruction(); } catch {}
          try {
            if (typeof api.setPerspective === 'function') api.setPerspective('G');
            if (typeof api.setAxesVisible === 'function') api.setAxesVisible(true, true);
            if (typeof api.setGridVisible === 'function') api.setGridVisible(true);
          } catch {}
        }

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
      opts.onLedgerChange?.(ledger);

      return {
        applied,
        failedFirstPass,
        durationMs: Math.round(performance.now() - t0),
        state: await collectState(api, ledger, generation),
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
  watchCanvasContext(api);

  // —— WebSocket 通道：daemon 反向调用 ——
  const connection = connectGgbDaemon({
    windowId: opts.windowId,
    wsUrl: opts.wsUrl ?? 'ws://127.0.0.1:8787',
    onStatus: opts.onConnectionChange,
    onMessage: async (ev, socket) => {
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
          case 'apply': {
            const a = (msg.args ?? {}) as { commands?: string[]; incremental?: boolean; ledger?: string[] };
            reply(await bridge.apply({ commands: a.commands ?? [], incremental: a.incremental, ledger: a.ledger }));
            break;
          }
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
    },
  });

  return Object.assign(() => {
    connection.close();
    const globals = window as unknown as Record<string, unknown>;
    if (globals[BRIDGE_KEY] === bridge) delete globals[BRIDGE_KEY];
  }, { reconnect: connection.reconnect });
}
