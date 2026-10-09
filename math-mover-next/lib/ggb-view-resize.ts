interface ViewMetrics {
  xMin: number;
  yMin: number;
  width: number;
  height: number;
  invXscale: number;
  invYscale: number;
}

function readMetrics(value: unknown): ViewMetrics | null {
  try {
    const view = typeof value === 'string' ? JSON.parse(value) : value;
    if (!view || typeof view !== 'object') return null;
    const { xMin, yMin, width, height, invXscale, invYscale } = view;
    if (![xMin, yMin, width, height, invXscale, invYscale].every(v => typeof v === 'number' && Number.isFinite(v))) return null;
    if (width <= 0 || height <= 0 || invXscale <= 0 || invYscale <= 0) return null;
    return { xMin, yMin, width, height, invXscale, invYscale };
  } catch { return null; }
}

export function resizedViewBounds(before: unknown, after: unknown) {
  const old = readMetrics(before);
  const next = readMetrics(after);
  if (!old || !next) return null;
  const centerX = old.xMin + old.width * old.invXscale / 2;
  const centerY = old.yMin + old.height * old.invYscale / 2;
  const halfWidth = next.width * old.invXscale / 2;
  const halfHeight = next.height * old.invYscale / 2;
  const bounds = { xMin: centerX - halfWidth, xMax: centerX + halfWidth, yMin: centerY - halfHeight, yMax: centerY + halfHeight };
  return Object.values(bounds).every(Number.isFinite) ? bounds : null;
}

interface ResizeApi {
  setSize: (width: number, height: number) => void;
  getViewProperties?: (view: number) => unknown;
  setCoordSystem?: (xMin: number, xMax: number, yMin: number, yMax: number) => void;
}

export function resizeAppletPreservingView(api: ResizeApi, width: number, height: number) {
  const read = () => {
    try { return api.getViewProperties?.(1); } catch { return null; }
  };
  const before = read();
  api.setSize(width, height);
  const bounds = resizedViewBounds(before, read());
  if (bounds && api.setCoordSystem) {
    api.setCoordSystem(bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax);
  }
}
