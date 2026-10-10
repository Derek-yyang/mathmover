import type { GeoGebraApi } from '@/components/dashboard/types';

export type AxesState = 'all' | 'none' | 'mixed';
export interface GgbGraphicsState {
  axes: AxesState;
  showGrid: boolean;
  settingsOpen: boolean;
  mode: '2D' | '3D';
  signature: string;
}

export function ggbClientEventType(event: unknown): string | null {
  if (typeof event === 'string') return event;
  if (Array.isArray(event)) return typeof event[0] === 'string' ? event[0] : null;
  if (event && typeof event === 'object' && 'type' in event && typeof event.type === 'string') return event.type;
  return null;
}

function visibleView(xml: string, id: number) {
  return (xml.match(/<view[\s][^>]*>/g) ?? []).some(tag => tag.includes(` id="${id}"`) && tag.includes(' visible="true"'));
}

export function readGgbGraphics(api: Pick<GeoGebraApi, 'getGraphicsOptions' | 'getPerspectiveXML'>): GgbGraphicsState | null {
  try {
    const xml = api.getPerspectiveXML?.() ?? '';
    const mode = visibleView(xml, 512) && !visibleView(xml, 1) ? '3D' : '2D';
    const raw = api.getGraphicsOptions?.(mode === '3D' ? -1 : 1);
    const options = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!options || typeof options.grid !== 'boolean' || !options.axes) return null;
    const axes = (mode === '3D' ? ['x', 'y', 'z'] : ['x', 'y']).map(axis => options.axes[axis]?.visible);
    if (!axes.every(value => typeof value === 'boolean')) return null;
    return { axes: axes.every(Boolean) ? 'all' : axes.some(Boolean) ? 'mixed' : 'none', showGrid: options.grid,
      settingsOpen: visibleView(xml, 4097), mode, signature: `${mode}:${JSON.stringify(options)}` };
  } catch { return null; }
}

/** Client events are arrays in the bundled runtime, and objects in newer adapters. */
export function watchGgbGraphics(api: GeoGebraApi, changed: (state: GgbGraphicsState) => void) {
  let disposed = false;
  let queued = false;
  let previous = '';
  const read = () => {
    queued = false;
    if (disposed) return;
    const state = readGgbGraphics(api);
    if (!state) return;
    const key = `${state.signature}:${state.settingsOpen}`;
    if (key === previous) return;
    previous = key;
    changed(state);
  };
  const client = (event: unknown) => {
    // Panning changes the viewport, not graphics options. Avoid parsing the
    // settings/perspective on every drag frame.
    if (!['viewPropertiesChanged', 'perspectiveChange', 'clear', 'undo', 'redo'].includes(ggbClientEventType(event) ?? '') || queued) return;
    queued = true;
    queueMicrotask(read);
  };
  api.registerClientListener?.(client);
  read();
  return () => { disposed = true; api.unregisterClientListener?.(client); };
}

// Snapshot loading must retain its own center rather than the previous document's.
const restoring = new WeakSet<object>();
export const isRestoringGgb = (api: object) => restoring.has(api);
export function beginGgbRestore(api: object) {
  restoring.add(api);
  return () => restoring.delete(api);
}
