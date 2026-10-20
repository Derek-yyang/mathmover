// Adapted official ThreadListSidebar composition; see ../UPSTREAM.md.
'use client';

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { SidebarContent, SidebarFooter, SidebarHeader } from '@/components/dashboard/SidebarSections';
import { cn } from '@/components/assistant-ui/utils';
import { ThreadList } from './thread-list.aui';

// The host supplies MathMover branding and library actions, plus its existing
// courseware runtime. Its outer clip/rail retains the optimized collapse path.
export const ThreadListSidebar = forwardRef<HTMLElement, ComponentPropsWithoutRef<'aside'> & {
  header: ReactNode;
  footer: ReactNode;
}>(({ header, footer, children, className, ...props }, ref) => (
  <aside ref={ref} data-sidebar="sidebar" className={cn('flex h-full flex-col bg-[var(--mm-canvas-shell)]', className)} {...props}>
    <SidebarHeader className="aui-sidebar-header h-14 shrink-0 flex-row items-center gap-2 px-3 py-0">
      {header}
    </SidebarHeader>
    <SidebarContent className="aui-sidebar-content gap-0 overflow-hidden">
      {children ?? <ThreadList />}
    </SidebarContent>
    <SidebarFooter className="aui-sidebar-footer shrink-0 gap-0.5 border-t border-[var(--mm-border-stone-200)]/70 px-3 py-2">
      {footer}
    </SidebarFooter>
  </aside>
));
ThreadListSidebar.displayName = 'ThreadListSidebar';
