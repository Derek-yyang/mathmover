import { MoreHorizontal, Shapes } from 'lucide-react';
import { timeAgo, type WorkItem } from '../lib/store';

const GRID_STYLE = {
  backgroundImage:
    'linear-gradient(#edeae2 1px, transparent 1px), linear-gradient(90deg, #edeae2 1px, transparent 1px)',
  backgroundSize: '15px 15px',
};

interface WorkCardProps {
  work: WorkItem;
  busy?: boolean;
  onOpen: () => void;
  onManage: () => void;
}

export function WorkCard({ work, busy, onOpen, onManage }: WorkCardProps) {
  return (
    <div className="relative rounded-2xl border border-border bg-card p-2 transition active:scale-[0.99]">
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="block w-full text-left disabled:opacity-50"
      >
        <span
          className="relative block aspect-[1.5] overflow-hidden rounded-xl bg-[#f8f7f3]"
          style={work.thumbnail ? undefined : GRID_STYLE}
        >
          {work.thumbnail ? (
            <img
              src={work.thumbnail}
              alt=""
              className="size-full object-cover"
              draggable={false}
            />
          ) : (
            <span className="grid size-full place-items-center">
              <Shapes className="size-5 text-muted-foreground" />
            </span>
          )}
        </span>
        <span className="mt-2 block truncate text-[12px] font-semibold">{work.title}</span>
        <span className="mt-0.5 block text-[10px] text-muted-foreground">
          {timeAgo(work.updatedAt)}
        </span>
      </button>

      <button
        type="button"
        onClick={onManage}
        disabled={busy}
        aria-label="管理课件"
        className="absolute right-3 top-3 grid size-8 place-items-center rounded-full border border-border/70 bg-white/90 text-muted-foreground shadow-sm transition active:scale-95 disabled:opacity-50"
      >
        <MoreHorizontal className="size-4" />
      </button>
    </div>
  );
}
