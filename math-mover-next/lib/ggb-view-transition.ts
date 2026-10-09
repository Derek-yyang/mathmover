export interface ViewBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface FrameClock {
  now: () => number;
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
}

// GeoGebra reports world units per pixel, not pixels per world unit.
export function readViewBounds(properties: unknown): ViewBounds | null {
  try {
    const view = typeof properties === 'string' ? JSON.parse(properties) : properties;
    if (!view || typeof view !== 'object') return null;
    const { xMin, yMin, width, height, invXscale, invYscale } = view;
    const values = [xMin, yMin, width, height, invXscale, invYscale];
    if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) return null;
    if (width <= 0 || height <= 0 || invXscale <= 0 || invYscale <= 0) return null;
    const xMax = xMin + width * invXscale;
    const yMax = yMin + height * invYscale;
    if (!Number.isFinite(xMax) || !Number.isFinite(yMax) || xMax <= xMin || yMax <= yMin) return null;
    return { xMin, xMax, yMin, yMax };
  } catch {
    return null;
  }
}

export function animateViewToCenter(
  apply: (bounds: ViewBounds) => void,
  from: ViewBounds,
  options: { reducedMotion?: boolean; clock?: FrameClock } = {},
): () => void {
  const halfWidth = (from.xMax - from.xMin) / 2;
  const halfHeight = (from.yMax - from.yMin) / 2;
  const centerX = from.xMin + halfWidth;
  const centerY = from.yMin + halfHeight;
  const target = { xMin: -halfWidth, xMax: halfWidth, yMin: -halfHeight, yMax: halfHeight };
  // An already centered view should not repaint or clear existing traces.
  if (Math.abs(centerX) < halfWidth * 1e-9 && Math.abs(centerY) < halfHeight * 1e-9) return () => {};
  if (options.reducedMotion) {
    apply(target);
    return () => {};
  }

  const clock = options.clock ?? {
    now: () => performance.now(),
    request: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
    cancel: (id: number) => cancelAnimationFrame(id),
  };
  const start = clock.now();
  let frame: number | null = null;
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    if (frame !== null) clock.cancel(frame);
    frame = null;
  };
  const tick: FrameRequestCallback = timestamp => {
    frame = null;
    if (cancelled) return;
    const progress = Math.min(1, Math.max(0, (timestamp - start) / 300));
    const remaining = (1 - progress) ** 4;
    try {
      apply(progress === 1 ? target : {
        xMin: centerX * remaining - halfWidth,
        xMax: centerX * remaining + halfWidth,
        yMin: centerY * remaining - halfHeight,
        yMax: centerY * remaining + halfHeight,
      });
    } catch {
      cancel();
      return;
    }
    if (!cancelled && progress < 1) frame = clock.request(tick);
  };
  frame = clock.request(tick);
  return cancel;
}
