import { Camera, ChevronRight, Images, PenLine } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BottomSheet } from './ui/bottom-sheet';

interface NewWorkSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTakePhoto: () => void;
  onPickPhoto: () => void;
  onText: () => void;
}

const OPTIONS: Array<{ icon: LucideIcon; label: string; onSelect: keyof Pick<NewWorkSheetProps, 'onTakePhoto' | 'onPickPhoto' | 'onText'> }> = [
  { icon: Camera, label: '拍照', onSelect: 'onTakePhoto' },
  { icon: Images, label: '从相册选择', onSelect: 'onPickPhoto' },
  { icon: PenLine, label: '输入文字题目', onSelect: 'onText' },
];

export function NewWorkSheet({
  open,
  onOpenChange,
  onTakePhoto,
  onPickPhoto,
  onText,
}: NewWorkSheetProps) {
  const handlers = { onTakePhoto, onPickPhoto, onText };

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="新建图形">
      <div className="space-y-2 pb-1">
        {OPTIONS.map(option => (
          <button
            key={option.label}
            type="button"
            onClick={handlers[option.onSelect]}
            className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 text-left transition active:scale-[0.99]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <option.icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1 text-[14px] font-semibold">{option.label}</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
