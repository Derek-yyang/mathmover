'use client';

import { useEffect, useRef } from 'react';

interface GeoGebraBoardProps {
  ggbBase64?: string;
  onAppletReady?: (applet: any) => void;
}

declare global {
  interface Window {
    GGBApplet: any;
    ggbApplet: any;
  }
}

export default function GeoGebraBoard({ ggbBase64, onAppletReady }: GeoGebraBoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 动态加载 GeoGebra 脚本
    const script = document.createElement('script');
    script.src = 'https://www.geogebra.org/apps/deployggb.js';
    script.async = true;
    
    script.onload = () => {
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
        "appletOnLoad": (api: any) => {
            api.setAxesVisible(true, true);
            api.setGridVisible(true);
            window.ggbApplet = api; // 确保全局句柄可用
            if (onAppletReady) onAppletReady(api);
        }
      };

      // 初始化 Applet
      // @ts-ignore
      const applet = new window.GGBApplet(params, true);
      
      if (containerRef.current) {
        applet.inject(containerRef.current);
      }
    };

    document.body.appendChild(script);

    return () => {
      // 清理脚本 (可选，通常 GGB 脚本是全局的)
      // document.body.removeChild(script);
    };
  }, []); // 空依赖数组，只在挂载时执行一次

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full rounded-xl overflow-hidden bg-white"
      id="ggb-element"
    />
  );
}
