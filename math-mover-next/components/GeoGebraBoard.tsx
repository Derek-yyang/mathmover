'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ensureGGBLoaded, GGB_CODEBASE } from '@/lib/ggb-runtime';
import { resizeAppletPreservingView, resizedViewBounds } from '@/lib/ggb-view-resize';
import { ggbClientEventType, isRestoringGgb, readGgbGraphics } from '@/lib/ggb-graphics-state';
import { registerGgbSettingsPanel } from '@/lib/ggb-settings-refresh';
import { createLiveResize } from '@/lib/live-resize';
import { BOARD_RESIZE_PREVIEW_EVENT } from '@/lib/board-resize-preview';
import { attachGgbGridRenderer } from '@/lib/ggb-grid-renderer';

type GeoGebraApi = any;

interface GeoGebraBoardProps {
  id?: string;
  ggbBase64?: string;
  onAppletReady?: (applet: GeoGebraApi) => void;
  width?: number | string;
  height?: number | string;
  showToolbar?: boolean;
  showAlgebraInput?: boolean;
  showMenuBar?: boolean;
  showResetIcon?: boolean;
  enableShiftDragZoom?: boolean;
  materialId?: string;
  // 允许接收其他未明确声明的任意属性 (应急方案)
  [key: string]: any;
}

declare global {
  interface Window {
    GGBApplet: any;
    ggbApplet: any;
    __GGB_LOAD_PROMISE__?: Promise<void>;
  }
}

export default function GeoGebraBoard({ id, ggbBase64, onAppletReady, showResetIcon = true }: GeoGebraBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GeoGebraApi | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // 初始化只执行一次，但就绪回调始终读取最新的课件和事件处理函数。
  const notifyAppletReady = useEffectEvent((api: GeoGebraApi) => {
    api.setAxesVisible(true, true);
    api.setGridVisible(true);

    if (ggbBase64) {
      try {
        api.setBase64(ggbBase64);
      } catch (e) {
        console.error('Failed to set initial ggbBase64', e);
      }
    }

    onAppletReady?.(api);
  });

  useEffect(() => {
    const container = containerRef.current;
    const stage = stageRef.current;
    if (!container || !stage) return;

    let cancelled = false;
    setLoadError(false);
    let lastSize: { width: number; height: number } | null = null;
    let internalResizeFrame = 0;
    let previousView: unknown = null;
    let adjustingView = false;
    let graphicsMode: '2D' | '3D' = '2D';
    let releaseSettingsPanel: (() => void) | undefined;
    let releaseGridRenderer: (() => void) | undefined;
    const previewSources = new Set<string>();
    let previewFrame = 0;
    let previewNode: HTMLElement | null = null;
    let previewBase: { width: number; height: number } | null = null;
    let previewOriginal: { transform: string; transformOrigin: string; pointerEvents: string; inert: boolean } | null = null;
    const readView = () => { try { return apiRef.current?.getViewProperties?.(1); } catch { return null; } };
    const viewSize = (value: unknown) => {
      try { const parsed = typeof value === 'string' ? JSON.parse(value) : value as { width?: number; height?: number } | null;
        return parsed ? `${parsed.width}:${parsed.height}` : ''; } catch { return ''; }
    };
    // The native settings panel resizes the internal graphics view, not the outer applet.
    const onViewChanged = (event: unknown) => {
      const type = ggbClientEventType(event);
      if (cancelled || adjustingView || !apiRef.current || !['perspectiveChange', 'viewChanged2D', 'viewPropertiesChanged'].includes(type ?? '')) return;
      if (type === 'perspectiveChange') graphicsMode = readGgbGraphics(apiRef.current)?.mode ?? graphicsMode;
      const current = readView();
      if (isRestoringGgb(apiRef.current) || graphicsMode === '3D') {
        if (internalResizeFrame) cancelAnimationFrame(internalResizeFrame);
        internalResizeFrame = 0; previousView = current; return;
      }
      if (!previousView || viewSize(previousView) === viewSize(current)) { previousView = current; return; }
      if (!internalResizeFrame) internalResizeFrame = requestAnimationFrame(() => {
        internalResizeFrame = 0;
        const api = apiRef.current;
        if (!api || cancelled || isRestoringGgb(api)) { previousView = readView(); return; }
        const bounds = resizedViewBounds(previousView, readView());
        if (bounds && api.setCoordSystem) {
          adjustingView = true;
          try { api.setCoordSystem(bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax); }
          finally { adjustingView = false; }
        }
        previousView = readView();
      });
    };

    const resizeApplet = () => {
      const api = apiRef.current;
      if (cancelled || !api) return;

      const width = stage.clientWidth;
      const height = stage.clientHeight;
      // 暂时隐藏的画布不应用零尺寸，重新显示时由 observer 同步。
      if (width <= 0 || height <= 0) return;
      if (lastSize?.width === width && lastSize.height === height) return;

      // External resizing already preserves the view. Do not schedule a second
      // coordinate correction from the synchronous events emitted by setSize.
      if (internalResizeFrame) cancelAnimationFrame(internalResizeFrame);
      internalResizeFrame = 0;
      adjustingView = true;
      try { resizeAppletPreservingView(api, width, height); }
      finally { adjustingView = false; previousView = readView(); }
      lastSize = { width, height };
    };

    const restorePreviewStyles = () => {
      if (previewNode && previewOriginal) {
        previewNode.style.transform = previewOriginal.transform;
        previewNode.style.transformOrigin = previewOriginal.transformOrigin;
        previewNode.style.pointerEvents = previewOriginal.pointerEvents;
        previewNode.inert = previewOriginal.inert;
      }
      previewNode = null;
      previewBase = null;
      previewOriginal = null;
    };
    const applyResizePreview = () => {
      previewFrame = 0;
      if (cancelled || previewSources.size === 0) return;
      if (!previewNode) {
        previewNode = container.querySelector<HTMLElement>('.applet_scaler')
          ?? container.querySelector<HTMLElement>('.GeoGebraFrame');
        if (!previewNode) return;
        const rect = previewNode.getBoundingClientRect();
        previewBase = { width: lastSize?.width ?? rect.width, height: lastSize?.height ?? rect.height };
        previewOriginal = { transform: previewNode.style.transform,
          transformOrigin: previewNode.style.transformOrigin, pointerEvents: previewNode.style.pointerEvents,
          inert: previewNode.inert };
      }
      const width = stage.clientWidth, height = stage.clientHeight;
      if (!previewBase || width <= 0 || height <= 0 || previewBase.width <= 0 || previewBase.height <= 0) return;
      previewNode.style.transformOrigin = '0 0';
      previewNode.style.transform = `scale(${width / previewBase.width}, ${height / previewBase.height})`;
      previewNode.style.pointerEvents = 'none';
      previewNode.inert = true;
    };
    const schedulePreview = () => {
      if (!previewFrame) previewFrame = requestAnimationFrame(applyResizePreview);
    };
    const onResizePreview = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string; active?: boolean }>).detail;
      if (!detail?.source) return;
      if (detail.active) {
        previewSources.add(detail.source);
        liveResize.cancel();
        schedulePreview();
        return;
      }
      previewSources.delete(detail.source);
      if (previewSources.size) return;
      if (previewFrame) cancelAnimationFrame(previewFrame);
      previewFrame = requestAnimationFrame(() => {
        previewFrame = 0;
        restorePreviewStyles();
        liveResize.cancel();
        resizeApplet();
      });
    };
    window.addEventListener(BOARD_RESIZE_PREVIEW_EVENT, onResizePreview);

    // Follow boundary motion with a compositor-scaled snapshot; perform one
    // exact GeoGebra resize when all active sidebar drags/transitions finish.
    const liveResize = createLiveResize(resizeApplet);
    const scheduleResize = () => {
      if (cancelled) return;
      if (previewSources.size) schedulePreview();
      else liveResize.schedule();
    };

    // 观察独立外层：注入节点会被 GeoGebra 写入固定尺寸，不能拿它做测量源。
    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(stage);

    ensureGGBLoaded().then(() => {
      if (cancelled) return;
      
      const params = {
        "appName": "classic",
        "perspective": "2", 
        "width": Math.max(1, stage.clientWidth),
        "height": Math.max(1, stage.clientHeight),
        "showToolBar": false,
        "showAlgebraInput": false,
        "showMenuBar": false,
        "enableShiftDragZoom": true,
        "showResetIcon": showResetIcon,
        "showAxes": true,
        "showGrid": true,
        "borderColor": "#D3D3D3", // 与未聚焦时一致，点击画布后边框也保持浅灰。
        "errorDialogsActive": false,
        "useBrowserForScale": false, // 手动接管尺寸控制，避免自动缩放逻辑打架
        "disableAutoScale": true,
        "appletOnLoad": (api: GeoGebraApi) => {
            if (cancelled) return;
            apiRef.current = api;
            window.ggbApplet = api; // 确保全局句柄可用（注意清理）
            releaseGridRenderer = attachGgbGridRenderer(container);
            resizeApplet();
            releaseSettingsPanel = registerGgbSettingsPanel(api, () =>
              container.querySelector<HTMLElement>('.PropertiesViewW')?.offsetWidth ?? 0);
            notifyAppletReady(api);
            previousView = readView();
            graphicsMode = readGgbGraphics(api)?.mode ?? '2D';
            api.registerClientListener?.(onViewChanged);
        }
      };

      // 初始化 Applet
      const applet = new window.GGBApplet(params, true);
      applet.setHTML5Codebase(GGB_CODEBASE, true);
      
      // 清空容器，防止重复注入
      container.replaceChildren();
      applet.inject(container);
    }).catch((error) => {
      if (!cancelled) {
        console.error('Failed to load GeoGebra', error);
        setLoadError(true);
      }
    });

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      window.removeEventListener(BOARD_RESIZE_PREVIEW_EVENT, onResizePreview);
      if (previewFrame) cancelAnimationFrame(previewFrame);
      restorePreviewStyles();
      releaseSettingsPanel?.();
      releaseGridRenderer?.();
      liveResize.cancel();
      if (internalResizeFrame) cancelAnimationFrame(internalResizeFrame);
      apiRef.current?.unregisterClientListener?.(onViewChanged);
      container.replaceChildren();
      // 仅当全局句柄属于当前实例时才清理，避免误伤其他实例
      if (window.ggbApplet === apiRef.current) {
        window.ggbApplet = undefined;
      }
      apiRef.current = null;
    };
  }, [showResetIcon, loadAttempt]); // 尺寸变化不会重新初始化 Applet。

  // 监听 ggbBase64 变化并更新
  useEffect(() => {
    if (apiRef.current && ggbBase64) {
      try {
        apiRef.current.setBase64(ggbBase64);
      } catch (e) {
        console.error('Failed to update ggbBase64', e);
      }
    }
  }, [ggbBase64]);

  return (
    <div ref={stageRef} className="geogebra-stage relative h-full w-full min-h-0 min-w-0 overflow-hidden bg-white">
      <div
        ref={containerRef}
        className="absolute inset-0 h-full! w-full! overflow-hidden bg-white"
        id={id || "ggb-element"}
      />
      {loadError && (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white p-6 text-sm text-stone-700">
          <p>本地画板资源加载失败，请先运行 npm run ggb:install 安装运行库。</p>
          <button type="button" onClick={() => setLoadAttempt(value => value + 1)} className="rounded-lg border border-stone-300 px-4 py-2 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700">重新加载</button>
        </div>
      )}
    </div>
  );
}
