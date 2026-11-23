import { useMemo, useState } from 'react';
import { Plus, Shapes } from 'lucide-react';
import type { WorkItem } from '../../lib/store';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { WorkCard } from '../work-card';

interface LibraryScreenProps {
  hidden: boolean;
  busy: boolean;
  works: WorkItem[];
  onNew: () => void;
  onOpenWork: (work: WorkItem) => void;
  onManageWork: (work: WorkItem) => void;
}

type SortMode = 'recent' | 'title';

export function LibraryScreen({
  hidden,
  busy,
  works,
  onNew,
  onOpenWork,
  onManageWork,
}: LibraryScreenProps) {
  const [sort, setSort] = useState<SortMode>('recent');

  const sorted = useMemo(() => {
    const items = [...works];
    return sort === 'recent'
      ? items.sort((a, b) => b.updatedAt - a.updatedAt)
      : items.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  }, [works, sort]);

  return (
    <section className={cn('h-full flex-col bg-background', hidden ? 'hidden' : 'flex')}>
      <div className="mx-auto flex h-full w-full max-w-[560px] flex-col">
        <header className="flex shrink-0 items-start justify-between px-5 pb-1 pt-[max(env(safe-area-inset-top),20px)]">
          <div>
            <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.035em]">课件</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">{works.length} 个课件</p>
          </div>
          <Button
            variant="secondary"
            size="icon"
            className="mt-1 rounded-full"
            onClick={onNew}
            aria-label="新建图形"
          >
            <Plus className="size-5" />
          </Button>
        </header>

        <div className="flex shrink-0 justify-end px-5 pb-2 pt-1">
          <div className="flex rounded-full bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setSort('recent')}
              className={cn(
                'rounded-full px-3 py-1.5 text-[11px] font-semibold transition',
                sort === 'recent' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              最近
            </button>
            <button
              type="button"
              onClick={() => setSort('title')}
              className={cn(
                'rounded-full px-3 py-1.5 text-[11px] font-semibold transition',
                sort === 'title' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
              )}
            >
              名称
            </button>
          </div>
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-6">
          {sorted.length === 0 ? (
            <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-4 py-14 text-muted-foreground">
              <Shapes className="size-6" />
              <p className="mt-2 text-[12px]">还没有课件</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {sorted.map(work => (
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
