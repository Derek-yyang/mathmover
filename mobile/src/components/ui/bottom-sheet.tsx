import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { Button } from './button';

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}

export function BottomSheet({ open, onOpenChange, title, children }: BottomSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/35" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-3xl bg-card outline-none"
        >
          <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-border" />
          <div className="flex items-center justify-between px-5 pt-3">
            <Drawer.Title className="text-[17px] font-bold tracking-tight">{title}</Drawer.Title>
            <Drawer.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="关闭">
                <X className="size-5" />
              </Button>
            </Drawer.Close>
          </div>
          <div className="overflow-y-auto px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-3">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
