import { useEffect, useRef, useState } from 'react';
import { Images, Loader2, RefreshCcw, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface CameraCaptureProps {
  onClose: () => void;
  onCapture: (dataUrl: string) => void;
  onPickPhoto: () => void;
  onUseSystemCamera: () => void;
  onFirstFrame: () => void;
}

function cameraErrorText(error: unknown) {
  if (!(error instanceof Error)) return '无法打开相机';
  if (error.name === 'NotAllowedError') {
    return '没有相机权限，请在系统设置里允许 MathMover 使用相机';
  }
  if (error.name === 'NotFoundError') return '没有找到可用的相机';
  if (error.name === 'NotReadableError') return '相机正被其他应用占用';
  if (error.name === 'OverconstrainedError') return '当前相机不支持所需参数';
  return error.message || '无法打开相机';
}

export function CameraCapture({
  onClose,
  onCapture,
  onPickPhoto,
  onUseSystemCamera,
  onFirstFrame,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const notifiedRef = useRef(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function markReady() {
    setReady(true);
    setVisible(true);
    if (!notifiedRef.current) {
      notifiedRef.current = true;
      onFirstFrame();
    }
  }

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    setReady(false);
    setError(null);

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('当前设备不支持应用内相机');
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        if (!cancelled) markReady();
      } catch (caught) {
        if (!cancelled) setError(cameraErrorText(caught));
      }
    }

    void start();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach(track => track.stop());
      if (streamRef.current === stream) streamRef.current = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, [facing]);

  function capture() {
    const video = videoRef.current;
    if (!video || !ready || capturing || video.readyState < 2) return;
    setCapturing(true);
    try {
      // 抓取画面里实际可见的部分，和取景框保持一致。
      const viewAspect = window.innerWidth / window.innerHeight;
      const videoAspect = video.videoWidth / video.videoHeight;
      let sw = video.videoWidth;
      let sh = video.videoHeight;
      let sx = 0;
      let sy = 0;
      if (videoAspect > viewAspect) {
        sw = Math.round(sh * viewAspect);
        sx = Math.round((video.videoWidth - sw) / 2);
      } else {
        sh = Math.round(sw / viewAspect);
        sy = Math.round((video.videoHeight - sh) / 2);
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, sw);
      canvas.height = Math.max(1, sh);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('无法抓取画面');
      context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      streamRef.current?.getTracks().forEach(track => track.stop());
      onCapture(dataUrl);
    } catch (caught) {
      setCapturing(false);
      setError(cameraErrorText(caught));
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div
        className={cn(
          'absolute inset-0 bg-black transition-opacity duration-200',
          visible ? 'opacity-100' : 'opacity-0',
        )}
      />
      <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          onLoadedData={markReady}
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity duration-200',
            visible ? 'opacity-100' : 'opacity-0',
            facing === 'user' && 'scale-x-[-1]',
          )}
        />

      <div
        className={cn(
          'absolute inset-x-0 top-0 z-20 flex justify-end px-4 pt-[max(env(safe-area-inset-top),14px)] transition-opacity duration-200',
          visible ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭相机"
          className="flex size-10 items-center justify-center rounded-full bg-black/45 text-white active:scale-95"
        >
          <X className="size-5" />
        </button>
      </div>

      {error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 px-8">
          <div className="w-full max-w-xs rounded-2xl bg-card p-5 text-center shadow-float">
            <p className="text-[14px] font-semibold text-foreground">相机打不开</p>
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={onUseSystemCamera}
              className="mt-5 h-11 w-full rounded-full bg-primary text-[14px] font-semibold text-primary-foreground active:scale-[0.98]"
            >
              改用系统相机
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 h-10 w-full rounded-full text-[13px] font-medium text-muted-foreground"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {!error && (
        <>
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 z-20 flex items-center justify-between px-8 pb-[max(env(safe-area-inset-bottom),24px)] pt-4 transition-opacity duration-200',
              visible ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            <button
              type="button"
              onClick={onPickPhoto}
              aria-label="从相册选择"
              className="flex size-11 items-center justify-center rounded-full bg-black/45 text-white active:scale-95"
            >
              <Images className="size-5" />
            </button>

            <button
              type="button"
              onClick={capture}
              disabled={!ready || capturing}
              aria-label="拍摄"
              className="flex size-[76px] items-center justify-center rounded-full border-4 border-white/85 active:scale-95 disabled:opacity-70"
            >
              {ready ? (
                <span className="size-[60px] rounded-full bg-white" />
              ) : (
                <Loader2 className="size-6 animate-spin text-white/80" />
              )}
            </button>

            <button
              type="button"
              onClick={() =>
                setFacing(current => (current === 'environment' ? 'user' : 'environment'))
              }
              aria-label="切换前后摄像头"
              className="flex size-11 items-center justify-center rounded-full bg-black/45 text-white active:scale-95"
            >
              <RefreshCcw className="size-5" />
            </button>
          </div>

          {ready && (
            <div className="pointer-events-none absolute inset-x-0 bottom-[max(env(safe-area-inset-bottom),116px)] z-20 flex justify-center">
              <span className="rounded-full bg-black/45 px-3 py-1.5 text-[11px] font-medium text-white/85">
                拍下题目，下一步框选
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
