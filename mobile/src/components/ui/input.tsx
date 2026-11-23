import * as React from 'react';
import { cn } from '../../lib/utils';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-12 w-full rounded-xl border border-input bg-card px-3.5 text-[15px] text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
