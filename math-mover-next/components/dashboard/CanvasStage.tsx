'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { GeoGebraApi } from './types';

const GeoGebraBoard = dynamic(() => import('@/components/GeoGebraBoard'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[var(--mm-canvas-shell)] text-[var(--mm-text-stone-400)] font-medium text-sm">
      正在加载 GeoGebra 引擎...
    </div>
  ),
});

interface CanvasStageProps {
  onAppletReady: (api: GeoGebraApi) => void;
  blocked?: boolean;
  opening?: boolean;
}

export default function CanvasStage({ onAppletReady, blocked = false, opening = false }: CanvasStageProps) {
  /**
   * 画板**不是**产品的拖入区——拖入区是右边的对话面板。但 GeoGebra 自带一个「文件丢这里」
   * 的提示：文件经过 applet 时它把 `.GeoGebraFrame` 的**行内** border-color 从
   * `rgb(211,211,211)` 改成 `rgb(255,0,0)`，移出/松手才变回来（2026-10-20 实测）。
   * 而它其实什么都不做——真 PNG 与真 `.ggb` 拖进去松手，对象数与构造 XML 一个字节都没变。
   * 于是一道红框等于在说「丢这里也行」，与对话区的绿色蒙层互相打架，落下去却毫无反应。
   *
   * 所以在 **capture 阶段**就把文件拖放吃掉：React 的 capture 监听挂在 root 上，先于
   * applet 自己的原生监听执行，所以 `stopPropagation` 之后 GeoGebra 的 dragenter 根本收不到，
   * 红框不会亮；`preventDefault` 顺手拦掉浏览器的默认行为（不拦的话落下去会导航到那个文件、
   * 把页面顶掉）。
   *
   * 只认 `Files`：页面内拖选文字、拖动别的元素照旧；GeoGebra 自己的拖动（点、滑块）走
   * pointer 事件，不经过 HTML5 drag-and-drop，不受影响。
   */
  const swallowFileDrag = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <main
      aria-label="数学课件画布"
      aria-busy={opening}
      onDragEnterCapture={swallowFileDrag}
      onDragOverCapture={swallowFileDrag}
      onDropCapture={swallowFileDrag}
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--mm-surface)]"
    >
      <div inert={blocked} className="h-full w-full">
        <GeoGebraBoard onAppletReady={onAppletReady} showResetIcon={false} />
      </div>
      {blocked && <div data-slot="board-interaction-guard" className="absolute inset-0 z-20 touch-none bg-[var(--mm-surface)]/40">
        <p role="status" className="absolute top-3 left-3 max-w-[calc(100%-24px)] rounded-lg bg-[var(--mm-surface)] px-3 py-1.5 text-sm leading-5 text-[var(--mm-text-stone-700)]">
          {opening ? '正在打开课件…' : '课件未能打开，请重试。'}
        </p>
      </div>}
    </main>
  );
}
