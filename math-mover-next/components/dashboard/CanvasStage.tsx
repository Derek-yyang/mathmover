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
  return (
    <main
      aria-label="数学课件画布"
      aria-busy={opening}
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
