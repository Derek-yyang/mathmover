import { forwardRef, useImperativeHandle, useState, type RefObject } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Camera,
  ChevronLeft,
  Eraser,
  Loader2,
  MoreHorizontal,
  Settings2,
  Share2,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { BottomSheet } from '../ui/bottom-sheet';
import { Button } from '../ui/button';

interface WorkspaceScreenProps {
  hidden: boolean;
  busy: boolean;
  title: string;
  canUndo: boolean;
  photo: string | null;
  progress: string | null;
  canvasRef: RefObject<HTMLDivElement | null>;
  onBack: () => void;
  onRetake: () => void;
  onModify: () => void;
  onShare: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onReset: () => void;
  onOpenSettings: () => void;
}

export interface WorkspaceScreenHandle {
  /** 关闭工作台内部浮层；返回 true 表示这次返回键已被消费。 */
  closeOverlay: () => boolean;
}

export const WorkspaceScreen = forwardRef<WorkspaceScreenHandle, WorkspaceScreenProps>(
  function WorkspaceScreen(
    {
      hidden,
      busy,
      title,
      canUndo,
      photo,
      progress,
      canvasRef,
      onBack,
      onRetake,
      onModify,
      onShare,
      onCancel,
      onUndo,
      onReset,
      onOpenSettings,
    },
    ref,
  ) {
    const [photoOpen, setPhotoOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        closeOverlay() {
          if (photoOpen) {
            setPhotoOpen(false);
            return true;
          }
          if (menuOpen) {
            setMenuOpen(false);
            return true;
          }
          return false;
        },
      }),
      [photoOpen, menuOpen],
    );

  return (
    <section
      className={cn(
        'fixed inset-0 bg-white',
        hidden ? 'hidden' : 'block',
      )}
    >
      {/* 画布独立成层，保证浮动操作栏始终在 GeoGebra 注入内容之上。 */}
      <div ref={canvasRef} className="absolute inset-0 z-0 isolate bg-card" />

      <div className="absolute inset-x-3 top-[max(env(safe-area-inset-top),12px)] z-20 flex items-center gap-1 rounded-full border border-border/80 bg-card px-1.5 py-1.5 shadow-soft">
        <Button variant="ghost" size="icon-sm" className="rounded-full" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate text-[13px] font-semibold leading-tight">{title}</div>
        </div>
        {photo && (
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            aria-label="查看题图"
            className="mr-0.5 size-8 shrink-0 overflow-hidden rounded-full ring-1 ring-border transition active:scale-95"
          >
            <img src={photo} alt="" className="size-full object-cover" />
          </button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          onClick={() => setMenuOpen(true)}
          aria-label="更多"
        >
          <MoreHorizontal className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-full"
          onClick={onOpenSettings}
          aria-label="设置"
        >
          <Settings2 className="size-5" />
        </Button>
      </div>

      {progress && (
        <div className="absolute inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),12px)+86px)] z-20 flex justify-center px-8">
          <div className="flex max-w-full items-center gap-2 rounded-full bg-foreground/92 py-1.5 pl-4 pr-1.5 text-xs font-medium text-background shadow-float">
            <Loader2 className="size-3.5 shrink-0 animate-spin" />
            <span className="truncate">{progress}</span>
            <button
              type="button"
              onClick={onCancel}
              aria-label="取消生成"
              className="ml-0.5 shrink-0 rounded-full bg-background/10 px-2.5 py-1 text-[11px] font-semibold text-background/85 transition active:bg-background/20"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="absolute inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-20 flex items-center gap-2 rounded-full border border-border bg-card p-2 shadow-float">
        <Button
          variant="ghost"
          size="icon-lg"
          className="rounded-full"
          onClick={onRetake}
          aria-label="重新拍"
        >
          <Camera className="size-5" />
        </Button>
        <Button className="h-12 flex-1" onClick={onModify} disabled={busy}>
          <Wand2 className="size-5" />
          继续修改
        </Button>
        <Button
          variant="secondary"
          size="icon-lg"
          className="rounded-full"
          onClick={onShare}
          disabled={busy}
          aria-label="保存或分享"
        >
          <Share2 className="size-5" />
        </Button>
      </div>

      <BottomSheet open={menuOpen} onOpenChange={setMenuOpen} title="更多">
        <div className="space-y-2 pb-1">
          <button
            type="button"
            disabled={!canUndo || busy}
            onClick={() => {
              setMenuOpen(false);
              onUndo();
            }}
            className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 text-left transition active:scale-[0.99] disabled:opacity-40"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
              <Undo2 className="size-5" />
            </span>
            <span className="min-w-0 flex-1 text-[14px] font-semibold">撤销上次操作</span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMenuOpen(false);
              onReset();
            }}
            className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 text-left transition active:scale-[0.99] disabled:opacity-40"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
              <Eraser className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">清空画布</span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">课件会保留</span>
            </span>
          </button>
        </div>
      </BottomSheet>

      <DialogPrimitive.Root open={photoOpen && Boolean(photo)} onOpenChange={setPhotoOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
          >
            <DialogPrimitive.Title className="sr-only">题图</DialogPrimitive.Title>
            {photo && (
              <img
                src={photo}
                alt="题图"
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            )}
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon-lg"
                className="absolute right-4 top-[max(env(safe-area-inset-top),16px)] rounded-full bg-white/15 text-white hover:bg-white/25 hover:text-white"
                aria-label="关闭题图"
              >
                <X className="size-5" />
              </Button>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </section>
    );
  },
);
