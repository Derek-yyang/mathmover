import { House, Settings2, Shapes } from 'lucide-react';
import { cn } from '../lib/utils';

export type MainTab = 'home' | 'works' | 'settings';

const TABS = [
  { id: 'home', label: '首页', icon: House },
  { id: 'works', label: '课件', icon: Shapes },
  { id: 'settings', label: '设置', icon: Settings2 },
] as const;

interface BottomBarProps {
  active: MainTab;
  onChange: (tab: MainTab) => void;
}

export function BottomBar({ active, onChange }: BottomBarProps) {
  return (
    <nav className="shrink-0 border-t border-border/80 bg-card pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-[560px] items-stretch px-2">
        {TABS.map(({ id, label, icon: Icon }) => {
          const selected = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-label={label}
              aria-current={selected ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-2.5 transition active:opacity-70',
                selected ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-[22px]" strokeWidth={selected ? 2.4 : 1.9} />
              <span
                className={cn(
                  'text-[10px] leading-none',
                  selected ? 'font-bold' : 'font-medium',
                )}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
