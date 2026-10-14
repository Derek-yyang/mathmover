// The bundled 5.4.931.2 runtime strokes parallel grid lines as one large path.
// On high-DPI canvases that path is expensive for Chrome's GPU rasterizer.
// Small, disjoint batches keep the same grid and full rendering resolution.
const MIN_PIXELS = 3_000_000;
const MIN_LINES = 24;
const BATCH_SIZE = 8;
type Line = [number, number, number, number];

/** Only independent, parallel lines qualify; curves and connected paths stay native. */
export function optimizeParallelGridStrokes(context: CanvasRenderingContext2D): () => void {
  if (typeof Path2D === 'undefined') return () => {};
  const cleanups: (() => void)[] = [];
  const replace = (name: string, wrapper: (...args: any[]) => any) => {
    const target = context as unknown as Record<string, unknown>;
    const descriptor = Object.getOwnPropertyDescriptor(context, name);
    target[name] = wrapper;
    cleanups.push(() => {
      if (target[name] !== wrapper) return;
      if (descriptor) Object.defineProperty(context, name, descriptor);
      else delete target[name];
    });
  };
  let lines: Line[] = [];
  let point: [number, number] | null = null;
  let valid = false;
  const beginPath = context.beginPath.bind(context);
  replace('beginPath', () => {
    lines = []; point = null; valid = true;
    return beginPath();
  });
  const moveTo = context.moveTo.bind(context);
  replace('moveTo', (x: number, y: number) => {
    point = [x, y];
    return moveTo(x, y);
  });
  const lineTo = context.lineTo.bind(context);
  replace('lineTo', (x: number, y: number) => {
    if (point && [point[0], point[1], x, y].every(Number.isFinite)) {
      lines.push([point[0], point[1], x, y]);
    } else valid = false;
    // Another lineTo without moveTo is a connected path, not a grid line.
    point = null;
    return lineTo(x, y);
  });
  for (const name of ['arc', 'arcTo', 'bezierCurveTo', 'quadraticCurveTo', 'ellipse',
    'rect', 'roundRect', 'closePath', 'transform', 'setTransform', 'resetTransform',
    'translate', 'rotate', 'scale', 'restore'] as const) {
    const original = context[name];
    if (typeof original !== 'function') continue;
    replace(name, (...args: unknown[]) => {
      valid = false;
      return Reflect.apply(original, context, args);
    });
  }
  const stroke = context.stroke.bind(context);
  replace('stroke', (...args: [] | [Path2D]) => {
    if (args.length || !valid || lines.length < MIN_LINES
      || context.canvas.width * context.canvas.height < MIN_PIXELS
      || context.lineWidth > 2 || context.globalCompositeOperation !== 'source-over'
      || context.shadowBlur || context.shadowOffsetX || context.shadowOffsetY
      || (context.filter && context.filter !== 'none')) return Reflect.apply(stroke, context, args);

    const horizontal = lines.every(line => line[1] === line[3]);
    const vertical = lines.every(line => line[0] === line[2]);
    if (!horizontal && !vertical) return stroke();
    const transform = context.getTransform();
    if (transform.b || transform.c || transform.a <= 0 || transform.d <= 0) return stroke();

    // Keep all segments on one row/column in the same batch. This preserves
    // native stroke union/alpha where a grid line is split around an axis label.
    const groups = new Map<number, Line[]>();
    for (const line of lines) {
      const position = horizontal ? line[1] : line[0];
      const group = groups.get(position);
      if (group) group.push(line);
      else groups.set(position, [line]);
    }
    const positions = [...groups.keys()].sort((a, b) => a - b);
    const scale = horizontal ? transform.d : transform.a;
    for (let i = 1; i < positions.length; i++) {
      // Disjoint antialias coverage: overlapping strokes must remain one path.
      if ((positions[i] - positions[i - 1] - context.lineWidth) * scale <= 2) return stroke();
    }
    for (let i = 0; i < positions.length; i += BATCH_SIZE) {
      const path = new Path2D();
      for (const position of positions.slice(i, i + BATCH_SIZE)) {
        for (const line of groups.get(position)!) {
          path.moveTo(line[0], line[1]);
          path.lineTo(line[2], line[3]);
        }
      }
      stroke(path);
    }
    // Path2D overload leaves the caller's current path intact for fill/clip/reuse.
  });
  return () => cleanups.reverse().forEach(cleanup => cleanup());
}

/** Scope the adapter to offscreen backgrounds copied into this applet's 2D views. */
export function attachGgbGridRenderer(container: HTMLElement): () => void {
  if (typeof Path2D === 'undefined') return () => {};
  const canvases = new Map<HTMLCanvasElement, () => void>();
  const attach = () => {
    for (const [canvas, cleanup] of canvases) {
      if (!container.contains(canvas)) { cleanup(); canvases.delete(canvas); }
    }
    for (const canvas of container.querySelectorAll<HTMLCanvasElement>('.EuclidianPanel canvas')) {
      if (canvases.has(canvas)) continue;
      const context = canvas.getContext('2d');
      if (!context) continue; // A 3D WebGL canvas retains its native context.
      const original = context.drawImage;
      const descriptor = Object.getOwnPropertyDescriptor(context, 'drawImage');
      let background: HTMLCanvasElement | null = null;
      let releaseBackground: (() => void) | undefined;
      const drawImage = (...args: Parameters<CanvasRenderingContext2D['drawImage']>) => {
        const source = args[0];
        if (source instanceof HTMLCanvasElement && !source.isConnected
          && source.width === canvas.width && source.height === canvas.height
          && source.width * source.height >= MIN_PIXELS && source !== background) {
          const sourceContext = source.getContext('2d');
          if (sourceContext) {
            releaseBackground?.();
            background = source;
            releaseBackground = optimizeParallelGridStrokes(sourceContext);
          }
        }
        return Reflect.apply(original, context, args);
      };
      context.drawImage = drawImage as CanvasRenderingContext2D['drawImage'];
      canvases.set(canvas, () => {
        releaseBackground?.();
        if (context.drawImage !== drawImage) return;
        if (descriptor) Object.defineProperty(context, 'drawImage', descriptor);
        else delete (context as unknown as Record<string, unknown>).drawImage;
      });
    }
  };
  attach();
  const observer = new MutationObserver(attach);
  observer.observe(container, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    for (const cleanup of canvases.values()) cleanup();
    canvases.clear();
  };
}
