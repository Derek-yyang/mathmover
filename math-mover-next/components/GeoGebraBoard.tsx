'use client';

import { useEffect, useRef } from 'react';

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

const GGB_SRC = 'https://www.geogebra.org/apps/deployggb.js';

function ensureGGBLoaded(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.GGBApplet) return Promise.resolve();
  
  const existing = document.querySelector(`script[src="${GGB_SRC}"]`) as HTMLScriptElement | null;
  if (existing) {
    if ((existing as any).__ggbLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', reject, { once: true });
    });
  }
  
  if (window.__GGB_LOAD_PROMISE__) return window.__GGB_LOAD_PROMISE__;
  
  const script = document.createElement('script');
  script.src = GGB_SRC;
  script.async = true;
  window.__GGB_LOAD_PROMISE__ = new Promise<void>((resolve, reject) => {
    script.onload = () => { 
      (script as any).__ggbLoaded = true; 
      resolve(); 
    };
    script.onerror = reject;
  });
  document.body.appendChild(script);
  return window.__GGB_LOAD_PROMISE__;
}

export default function GeoGebraBoard({ id, ggbBase64, onAppletReady }: GeoGebraBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GeoGebraApi | null>(null);

  useEffect(() => {
    let cancelled = false;

    ensureGGBLoaded().then(() => {
      if (cancelled || !containerRef.current) return;
      
      const params = {
        "appName": "classic",
        "perspective": "2", 
        "width": 900, 
        "height": 600,
        "showToolBar": false,
        "showAlgebraInput": false,
        "showMenuBar": false,
        "enableShiftDragZoom": true,
        "showResetIcon": true,
        "showAxes": true,
        "showGrid": true,
        "errorDialogsActive": false,
        "useBrowserForScale": false, // 手动接管尺寸控制，避免自动缩放逻辑打架
        "appletOnLoad": (api: GeoGebraApi) => {
            if (cancelled) return;
            apiRef.current = api;
            window.ggbApplet = api; // 确保全局句柄可用（注意清理）
            
            // 设置初始状态
            api.setAxesVisible(true, true);
            api.setGridVisible(true);
            
            // 如果有初始 Base64，立即应用
            if (ggbBase64) {
              try {
                api.setBase64(ggbBase64);
              } catch (e) {
                console.error('Failed to set initial ggbBase64', e);
              }
            }

            if (onAppletReady) onAppletReady(api);
        }
      };

      // 初始化 Applet
      const applet = new window.GGBApplet(params, true);
      
      // 清空容器，防止重复注入
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
        applet.inject(containerRef.current);
      }
    });

    return () => {
      cancelled = true;
      // 清理容器内容
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      // 仅当全局句柄属于当前实例时才清理，避免误伤其他实例
      if (window.ggbApplet === apiRef.current) {
        window.ggbApplet = undefined;
      }
      apiRef.current = null;
    };
  }, []); // 空依赖数组，只在挂载时执行一次初始化

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
    <div 
      ref={containerRef} 
      className="w-full h-full rounded-xl overflow-hidden bg-white"
      id={id || "ggb-element"}
    />
  );
}
