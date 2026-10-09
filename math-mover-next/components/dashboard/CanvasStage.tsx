'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { GeoGebraApi } from './types';

const GeoGebraBoard = dynamic(() => import('@/components/GeoGebraBoard'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#FDFCF8] text-stone-400 font-medium text-sm">
      正在加载 GeoGebra 引擎...
    </div>
  ),
});

interface CanvasStageProps {
  onAppletReady: (api: GeoGebraApi) => void;
}

export default function CanvasStage({ onAppletReady }: CanvasStageProps) {
  return (
    <main
      aria-label="数学课件画布"
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-white"
    >
      <GeoGebraBoard onAppletReady={onAppletReady} showResetIcon={false} />
    </main>
  );
}
