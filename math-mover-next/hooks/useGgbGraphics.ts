'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GeoGebraApi } from '@/components/dashboard/types';
import { readGgbGraphics, watchGgbGraphics, type GgbGraphicsState } from '@/lib/ggb-graphics-state';

const initial: GgbGraphicsState = { axes: 'all', showGrid: true, settingsOpen: false, mode: '2D', signature: '' };
function refreshSettings(api: GeoGebraApi, open: boolean) {
  // This bundle caches some native checkboxes after external API writes.
  // Re-enter through its public view API so it reads the updated properties.
  if (open) { api.setPerspective('-P'); api.setPerspective('+P'); }
}
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
    refreshSettings(api, actual.settingsOpen);
    sync();
  }, [api, state, sync]);
  const toggleGrid = useCallback(() => {
    if (!api) return;
    const actual = readGgbGraphics(api) ?? state;
    if (actual.mode === '3D') api.setGridVisible(3, !actual.showGrid);
    else api.setGridVisible(!actual.showGrid);
    refreshSettings(api, actual.settingsOpen);
    sync();
  }, [api, state, sync]);
  const toggleSettings = useCallback(() => {
    if (!api) return;
    api.setPerspective((readGgbGraphics(api) ?? state).settingsOpen ? '-P' : '+P');
    sync();
  }, [api, state, sync]);
  return { ...state, sync, toggleAxes, toggleGrid, toggleSettings };
}
