import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Loader2, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface PhotoCropProps {
  src: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

/** 框选区域最小边长（屏幕像素），避免缩到点不中。 */
const MIN_SIZE = 64;
/** 裁切后图片最长边，控制发送给模型的体积。 */
const MAX_EDGE = 1600;

const HANDLES: { mode: DragMode; className: string }[] = [
  { mode: 'nw', className: 'left-0 top-0 rounded-tl-md border-l-[3px] border-t-[3px]' },
  { mode: 'ne', className: 'right-0 top-0 rounded-tr-md border-r-[3px] border-t-[3px]' },
  { mode: 'sw', className: 'bottom-0 left-0 rounded-bl-md border-b-[3px] border-l-[3px]' },
  { mode: 'se', className: 'bottom-0 right-0 rounded-br-md border-b-[3px] border-r-[3px]' },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function PhotoCrop({ src, onCancel, onConfirm }: PhotoCropProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; rect: Rect } | null>(
    null,
  );
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState<Rect | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setContainer({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // 图片按 contain 铺在容器里，框选坐标只相对这张图的显示区域。
  const box = useMemo(() => {
    if (!container.w || !container.h || !natural.w || !natural.h) return null;
    const scale = Math.min(container.w / natural.w, container.h / natural.h);
    const width = natural.w * scale;
    const height = natural.h * scale;
    return {
      left: (container.w - width) / 2,
      top: (container.h - height) / 2,
      width,
      height,
    };
  }, [container, natural]);

  // 图片尺寸或屏幕方向变化时，默认留出足够边距，四角不贴屏幕边缘，方便直接拖。
  useEffect(() => {
    if (!box) return;
    const inset = Math.min(48, box.width / 3, box.height / 3);
    setRect({
      x: inset,
      y: inset,
      w: box.width - inset * 2,
      h: box.height - inset * 2,
    });
  }, [box]);

  function startDrag(mode: DragMode, event: ReactPointerEvent<HTMLElement>) {
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setTouched(true);
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      rect,
    };
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || !box) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const base = drag.rect;

    if (drag.mode === 'move') {
      setRect({
        ...base,
        x: clamp(base.x + dx, 0, box.width - base.w),
        y: clamp(base.y + dy, 0, box.height - base.h),
      });
      return;
    }

    let left = base.x;
    let top = base.y;
    let right = base.x + base.w;
    let bottom = base.y + base.h;
    if (drag.mode.includes('w')) left = clamp(base.x + dx, 0, right - MIN_SIZE);
    if (drag.mode.includes('e')) right = clamp(right + dx, left + MIN_SIZE, box.width);
    if (drag.mode.includes('n')) top = clamp(base.y + dy, 0, bottom - MIN_SIZE);
    if (drag.mode.includes('s')) bottom = clamp(bottom + dy, top + MIN_SIZE, box.height);
    setRect({ x: left, y: top, w: right - left, h: bottom - top });
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // 指针已被系统回收时忽略
    }
  }

  async function confirm() {
    const image = imageRef.current;
    if (!rect || !box || !image || confirming) return;
    setConfirming(true);
    try {
      const scale = natural.w / box.width;
      const sx = Math.round(rect.x * scale);
      const sy = Math.round(rect.y * scale);
      const sw = Math.max(1, Math.round(rect.w * scale));
      const sh = Math.max(1, Math.round(rect.h * scale));
      const outputScale = Math.min(1, MAX_EDGE / Math.max(sw, sh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw * outputScale));
      canvas.height = Math.max(1, Math.round(sh * outputScale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法处理图片');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      onConfirm(canvas.toDataURL('image/jpeg', 0.85));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#0B0F0E]">
      <div
        ref={containerRef}
        className="absolute inset-x-0 bottom-0 top-[calc(max(env(safe-area-inset-top),14px)+52px)] touch-none select-none overflow-hidden"
      >
        <img
          ref={imageRef}
          src={src}
          alt=""
          draggable={false}
          onLoad={event =>
            setNatural({
              w: event.currentTarget.naturalWidth,
              h: event.currentTarget.naturalHeight,
            })
          }
          className="pointer-events-none absolute select-none"
          style={
            box
              ? { left: box.left, top: box.top, width: box.width, height: box.height }
              : { visibility: 'hidden' }
          }
        />

        {box && rect && (
          <div
            className="absolute cursor-move"
            style={{
              left: box.left + rect.x,
              top: box.top + rect.y,
              width: rect.w,
              height: rect.h,
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.38)',
            }}
            onPointerDown={event => startDrag('move', event)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="pointer-events-none absolute inset-x-9 top-0 border-t-[1.5px] border-dashed border-primary" />
            <div className="pointer-events-none absolute inset-x-9 bottom-0 border-b-[1.5px] border-dashed border-primary" />
            <div className="pointer-events-none absolute inset-y-9 left-0 border-l-[1.5px] border-dashed border-primary" />
            <div className="pointer-events-none absolute inset-y-9 right-0 border-r-[1.5px] border-dashed border-primary" />
            {HANDLES.map(handle => (
              <span
                key={handle.mode}
                className={cn('absolute size-9 touch-none border-primary', handle.className)}
                onPointerDown={event => startDrag(handle.mode, event)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between px-4 pt-[max(env(safe-area-inset-top),14px)]">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 rounded-full bg-card/90 py-2 pl-3 pr-4 text-[13px] font-semibold text-foreground active:scale-95"
        >
          <X className="size-4" />
          取消
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={!rect || confirming}
          className="flex items-center gap-1.5 rounded-full bg-card px-4 py-2 text-[13px] font-semibold text-primary active:scale-95 disabled:opacity-60"
        >
          {confirming && <Loader2 className="size-4 animate-spin" />}
          完成
        </button>
      </div>

      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-[max(env(safe-area-inset-bottom),18px)] z-20 flex justify-center transition-opacity',
          touched ? 'opacity-0' : 'opacity-100',
        )}
      >
        <span className="rounded-full bg-black/45 px-3 py-1.5 text-[11px] font-medium text-white/85">
          拖动边框框选题目
        </span>
      </div>
    </div>
  );
}
