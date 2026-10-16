import type { ReactNode } from 'react';
import { Button, type ButtonProps } from '../assistant-ui/ui/button';
import { Badge } from '../assistant-ui/ui/badge';
import { cn } from '../assistant-ui/utils';

// Shared sizing and theme for settings actions; behavior stays in the host pages.
export function SettingsButton({ className, variant = 'ghost', size = 'sm', ...props }: ButtonProps) {
  return <Button variant={variant} size={size} className={cn(
    'rounded-lg text-sm shadow-none focus-visible:ring-primary motion-reduce:transition-none',
    variant === 'ghost' && 'text-[var(--mm-text-stone-700)] hover:bg-[var(--mm-bg-stone-100)] hover:text-[var(--mm-text-stone-900)]',
    className,
  )} {...props} />;
}

const statusTone = {
  success: 'bg-[var(--mm-bg-emerald-100)] text-[var(--mm-text-emerald-900)]',
  warning: 'bg-[var(--mm-bg-amber-100)] text-[var(--mm-text-amber-900)]',
  neutral: 'bg-[var(--mm-bg-stone-200)] text-[var(--mm-text-stone-700)]',
};

export function SettingsStatusBadge({ tone = 'neutral', children }: { tone?: keyof typeof statusTone; children: ReactNode }) {
  return <Badge variant="ghost" className={cn('h-5 px-1.5 py-0 leading-none', statusTone[tone])}>{children}</Badge>;
}
