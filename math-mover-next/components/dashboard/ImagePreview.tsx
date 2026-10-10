'use client';

// Gallery selection, keyboard navigation and focus restoration adapted from
// assistant-ui ImageGallery (MIT); zoom/pan and the staged-image entry are MathMover extensions.
// https://www.assistant-ui.com/elements/image-gallery
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, Scan, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { constrainImage, fitImage, zoomImage, type ImageTransform, type Size } from '@/lib/image-view';

export interface PreviewImage { url: string; name?: string; unavailable?: boolean }
type OpenPreview = (images: readonly PreviewImage[], index: number) => void;
const Context = createContext<OpenPreview | null>(null);
export function useImagePreview() {
  const open = useContext(Context);
  if (!open) throw new Error('ImagePreviewProvider is missing');
  return open;
}

export function ImagePreviewProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ images: PreviewImage[]; index: number } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const open = useCallback<OpenPreview>((images, index) => {
    const selected = images[index];
    if (!selected?.url || selected.unavailable) return;
    const available = images.filter(image => image.url && !image.unavailable);
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRequest({ images: available, index: available.indexOf(selected) });
  }, []);
  return <Context.Provider value={open}>
    {children}
    {request && <Dialog open onOpenChange={next => { if (!next) setRequest(null); }}>
      <DialogContent className="image-reading-dialog" onCloseAutoFocus={event => {
        event.preventDefault();
        if (trigger.current?.isConnected) trigger.current.focus();
      }} onKeyDown={event => {
        const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (!offset) return;
        event.preventDefault();
        setRequest(previous => previous ? { ...previous, index: Math.max(0, Math.min(previous.images.length - 1, previous.index + offset)) } : null);
      }}>
        <DialogTitle className="reading-dialog-title">{request.images[request.index].name || '题目图片'}</DialogTitle>
        <DialogDescription className="sr-only">滚轮缩放，拖动查看图片；左右方向键切换，按 Escape 或点击外部关闭。</DialogDescription>
        <ImageCanvas key={request.index} image={request.images[request.index]} />
        {request.images.length > 1 && <div className="image-gallery-controls">
          <button aria-label="上一张题图" aria-disabled={request.index === 0} onClick={() => setRequest(previous => previous ? { ...previous, index: Math.max(0, previous.index - 1) } : null)}><ChevronLeft aria-hidden size={18} /></button>
          <span aria-live="polite">{request.index + 1} / {request.images.length}</span>
          <button aria-label="下一张题图" aria-disabled={request.index === request.images.length - 1} onClick={() => setRequest(previous => previous ? { ...previous, index: Math.min(previous.images.length - 1, previous.index + 1) } : null)}><ChevronRight aria-hidden size={18} /></button>
        </div>}
      </DialogContent>
    </Dialog>}
  </Context.Provider>;
}

function ImageCanvas({ image }: { image: PreviewImage }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [imageSize, setImageSize] = useState<Size>({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState<Size>({ width: 0, height: 0 });
  const [transform, setTransform] = useState<ImageTransform>({ scale: 1, x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; transform: ImageTransform } | null>(null);
  const ready = imageSize.width > 0 && !failed;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!imageSize.width) return;
    // A new viewport starts with the whole question visible.
    setTransform({ scale: fitImage(imageSize, viewportSize), x: 0, y: 0 });
  }, [imageSize, viewportSize]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !ready) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const amount = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      const factor = Math.exp(-Math.max(-150, Math.min(150, amount)) * 0.006);
      setTransform(previous => zoomImage(previous, previous.scale * factor,
        { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 }, imageSize, viewportSize));
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [imageSize, viewportSize, ready]);

  const zoom = (factor: number) => setTransform(previous => zoomImage(previous, previous.scale * factor, { x: 0, y: 0 }, imageSize, viewportSize));
  const stopDrag = () => { drag.current = null; setDragging(false); };
  return <>
    <div className="image-view-toolbar">
      <button aria-label="缩小题图" disabled={!ready || transform.scale <= fitImage(imageSize, viewportSize) + 0.0001} onClick={() => zoom(1 / 1.25)}><Minus aria-hidden size={16} /></button>
      <span aria-live="polite" aria-label="图片缩放比例">{ready ? `${Math.round(transform.scale * 100)}%` : '—'}</span>
      <button aria-label="放大题图" disabled={!ready || transform.scale >= 8} onClick={() => zoom(1.25)}><Plus aria-hidden size={16} /></button>
      <button disabled={!ready} onClick={() => setTransform({ scale: fitImage(imageSize, viewportSize), x: 0, y: 0 })}><Scan aria-hidden size={16} />适应窗口</button>
      <button disabled={!ready} onClick={() => setTransform({ scale: 1, x: 0, y: 0 })}><RotateCcw aria-hidden size={16} />原始比例</button>
    </div>
    <div ref={viewportRef} data-image-viewport className={`image-view-viewport ${dragging ? 'is-dragging' : ''}`} onPointerDown={event => {
      if (!ready || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, transform };
      setDragging(true);
    }} onPointerMove={event => {
      const start = drag.current;
      if (!start || start.id !== event.pointerId) return;
      setTransform(constrainImage({ ...start.transform, x: start.transform.x + event.clientX - start.x,
        y: start.transform.y + event.clientY - start.y }, imageSize, viewportSize));
    }} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}>
      {!ready && !failed && <p role="status">正在加载题图…</p>}
      {failed ? <div role="alert"><p>图片无法加载。</p><button className="reading-text-button" onClick={() => { setFailed(false); setImageSize({ width: 0, height: 0 }); setAttempt(previous => previous + 1); }}>重试加载</button></div>
        : <img key={attempt} src={image.url} alt={image.name || '题目图片'} draggable={false} onError={() => setFailed(true)} onLoad={event => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          style={{ width: imageSize.width || undefined, height: imageSize.height || undefined, visibility: ready ? 'visible' : 'hidden', transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }} />}
    </div>
  </>;
}
