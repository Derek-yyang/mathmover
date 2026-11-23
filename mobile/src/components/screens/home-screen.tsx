import { Camera, ChevronRight, Image, KeyRound, PenLine, Shapes } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { WorkItem } from '../../lib/store';
import { WorkCard } from '../work-card';

interface HomeScreenProps {
  hidden: boolean;
  busy: boolean;
  works: WorkItem[];
  configured: boolean;
  onTakePhoto: () => void;
  onPickPhoto: () => void;
  onComposeText: () => void;
  onOpenWork: (work: WorkItem) => void;
  onManageWork: (work: WorkItem) => void;
  onOpenWorks: () => void;
  onConfigure: () => void;
}

export function HomeScreen({
  hidden,
  busy,
  works,
  configured,
  onTakePhoto,
  onPickPhoto,
  onComposeText,
  onOpenWork,
  onManageWork,
  onOpenWorks,
  onConfigure,
}: HomeScreenProps) {
  const recentWorks = works.slice(0, 2);

  return (
    <section className={cn('h-full flex-col bg-background', hidden ? 'hidden' : 'flex')}>
      <div className="mx-auto flex h-full w-full max-w-[560px] flex-col">
        <header className="flex shrink-0 items-center gap-2.5 px-5 pb-2 pt-[max(env(safe-area-inset-top),20px)]">
          <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <span className="text-[18px] font-bold leading-none tracking-[-0.06em]">M</span>
          </div>
          <span className="text-[17px] font-extrabold tracking-[-0.02em]">MathMover</span>
        </header>

        <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-2">
          {!configured && (
            <button
              type="button"
              onClick={onConfigure}
              className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-left transition active:scale-[0.99]"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
                <KeyRound className="size-5" />
              </span>
              <span className="min-w-0 flex-1 text-[13px] font-semibold text-amber-900">
                模型未配置
              </span>
              <span className="text-[11px] font-medium text-amber-700">去配置</span>
              <ChevronRight className="size-4 text-amber-700" />
            </button>
          )}

          <button
            type="button"
            onClick={onTakePhoto}
            disabled={busy}
            className="mt-2 flex w-full flex-col items-center justify-center gap-2.5 rounded-[26px] bg-primary py-7 text-primary-foreground shadow-[0_14px_30px_-18px_rgba(16,185,129,0.75)] transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="grid size-12 place-items-center rounded-full bg-white/15">
              <Camera className="size-6" />
            </span>
            <span className="text-[16px] font-bold">拍照新建</span>
          </button>

          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onPickPhoto}
              disabled={busy}
              className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-card text-[13px] font-semibold transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
            >
              <Image className="size-5 text-muted-foreground" />
              相册
            </button>
            <button
              type="button"
              onClick={onComposeText}
              disabled={busy}
              className="flex h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-card text-[13px] font-semibold transition active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
            >
              <PenLine className="size-5 text-muted-foreground" />
              文字
            </button>
          </div>

          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-[12px] font-bold">最近</h2>
            {works.length > 0 && (
              <button
                type="button"
                onClick={onOpenWorks}
                className="flex items-center gap-0.5 text-[11px] text-muted-foreground"
              >
                全部课件
                <ChevronRight className="size-3.5" />
              </button>
            )}
          </div>

          {works.length === 0 ? (
            <div className="mt-3 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-4 py-10 text-muted-foreground">
              <Shapes className="size-6" />
              <p className="mt-2 text-[12px]">还没有课件</p>
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-2 gap-2.5">
              {recentWorks.map(work => (
                <WorkCard
                  key={work.id}
                  work={work}
                  busy={busy}
                  onOpen={() => onOpenWork(work)}
                  onManage={() => onManageWork(work)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
