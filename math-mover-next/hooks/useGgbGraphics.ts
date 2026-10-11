'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GeoGebraApi } from '@/components/dashboard/types';
import { readGgbGraphics, watchGgbGraphics, type GgbGraphicsState } from '@/lib/ggb-graphics-state';
import { refreshGgbSettings } from '@/lib/ggb-settings-refresh';

const initial: GgbGraphicsState = { axes: 'all', showGrid: true, settingsOpen: false, mode: '2D', signature: '' };
export function useGgbGraphics(api: GeoGebraApi | null) {
  const [state, setState] = useState(initial);
  useEffect(() => api ? watchGgbGraphics(api, setState) : undefined, [api]);
  const sync = useCallback(() => { if (api) { const next = readGgbGraphics(api); if (next) setState(next); } }, [api]);
  const toggleAxes = useCallback(() => {
    if (!api) return;
    const actual = readGgbGraphics(api) ?? state;
    const show = actual.axes !== 'all';
    if (actual.mode === '3D') api.setAxesVisible(3, show, show, show);
    else api.setAxesVisible(show, show);
    refreshGgbSettings(api, actual.settingsOpen);
    sync();
  }, [api, state, sync]);
  const toggleGrid = useCallback(() => {
    if (!api) return;
    const actual = readGgbGraphics(api) ?? state;
    if (actual.mode === '3D') api.setGridVisible(3, !actual.showGrid);
    else api.setGridVisible(!actual.showGrid);
    refreshGgbSettings(api, actual.settingsOpen);
    sync();
  }, [api, state, sync]);
  const toggleSettings = useCallback(() => {
    if (!api) return;
    api.setPerspective((readGgbGraphics(api) ?? state).settingsOpen ? '-P' : '+P');
    sync();
  }, [api, state, sync]);
  return { ...state, sync, toggleAxes, toggleGrid, toggleSettings };
}
