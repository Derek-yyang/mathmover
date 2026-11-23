import type { SettingsValue } from '../../lib/store';
import { cn } from '../../lib/utils';
import { SettingsForm } from '../settings-form';

interface SettingsScreenProps {
  hidden: boolean;
  initial: SettingsValue;
  onSave: (next: SettingsValue) => void;
  onTest: (next: SettingsValue) => Promise<void>;
}

export function SettingsScreen({
  hidden,
  initial,
  onSave,
  onTest,
}: SettingsScreenProps) {
  return (
    <section className={cn('h-full flex-col bg-background', hidden ? 'hidden' : 'flex')}>
      <div className="mx-auto flex h-full w-full max-w-[560px] flex-col">
        <header className="shrink-0 px-5 pb-2 pt-[max(env(safe-area-inset-top),20px)]">
          <h1 className="text-[30px] font-extrabold leading-tight tracking-[-0.035em]">设置</h1>
        </header>

        <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-8 pt-3">
          <SettingsForm
            initial={initial}
            onSave={onSave}
            onTest={onTest}
          />
        </div>
      </div>
    </section>
  );
}
