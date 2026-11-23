import type { SettingsValue } from '../lib/store';
import { BottomSheet } from './ui/bottom-sheet';
import { SettingsForm } from './settings-form';

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: SettingsValue;
  onSave: (next: SettingsValue) => void;
  onTest: (next: SettingsValue) => Promise<void>;
}

export function SettingsSheet({
  open,
  onOpenChange,
  initial,
  onSave,
  onTest,
}: SettingsSheetProps) {
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="模型设置">
      {/* 每次打开重新挂载，清掉上次的测试结果和输入。 */}
      <SettingsForm
        key={open ? 'open' : 'closed'}
        initial={initial}
        onSave={onSave}
        onTest={onTest}
        onSaved={() => onOpenChange(false)}
      />
    </BottomSheet>
  );
}
