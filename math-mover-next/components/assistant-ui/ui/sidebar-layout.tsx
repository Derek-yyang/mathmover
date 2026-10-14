// Structural components extracted from the official shadcn/ui Sidebar.
// See ../UPSTREAM.md; collapse and canvas resize stay owned by the dashboard.
import * as React from 'react';
import { cn } from '@/components/assistant-ui/utils';

export const SidebarHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => <div ref={ref} data-sidebar="header"
    className={cn('flex flex-col gap-2 p-2', className)} {...props} />,
);
SidebarHeader.displayName = 'SidebarHeader';

export const SidebarContent = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => <div ref={ref} data-sidebar="content"
    className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden', className)} {...props} />,
);
SidebarContent.displayName = 'SidebarContent';

export const SidebarFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => <div ref={ref} data-sidebar="footer"
    className={cn('flex flex-col gap-2 p-2', className)} {...props} />,
);
SidebarFooter.displayName = 'SidebarFooter';
