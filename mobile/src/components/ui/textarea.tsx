import * as React from 'react';
import { cn } from '../../lib/utils';

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'min-h-[112px] w-full resize-none rounded-xl border border-input bg-card px-3.5 py-3 text-[15px] leading-relaxed text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
