'use client';

// Adapted from assistant-ui's MIT-licensed Radix dialog component.
// https://github.com/assistant-ui/assistant-ui/blob/main/packages/ui/src/components/react/ui/radix/dialog.tsx
import type { ComponentProps } from 'react';
import { Dialog as Primitive } from 'radix-ui';
import { X } from 'lucide-react';

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;

export function DialogContent({ children, className = '', ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal>
    <Primitive.Overlay className="reading-dialog-overlay" />
    <Primitive.Content className={`reading-dialog ${className}`} {...props}>
      {children}
      <Primitive.Close aria-label="关闭预览" className="reading-dialog-close" title="关闭预览"><X aria-hidden size={18} /></Primitive.Close>
    </Primitive.Content>
  </Primitive.Portal>;
}
