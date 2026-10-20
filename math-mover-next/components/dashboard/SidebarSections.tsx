'use client';

import * as React from 'react';
import { cn } from '@/components/assistant-ui/utils';

/**
 * 侧栏的三段容器：头 / 体 / 脚。
 *
 * 这三个早先是 `assistant-ui/ui/sidebar-layout.tsx`——从官方 shadcn `sidebar` 里
 * 抠出来的 Header/Content/Footer 三个 div。问题是官方那套真正值钱的东西
 * （`SidebarProvider`、`SidebarMenu`、`collapsible="icon"`、⌘B、cookie 持久化、移动端 sheet）
 * 我们一个都没用：折叠与画板 resize 一直由 `DashboardSidebar` 自己管。
 * 于是那份 vendored 文件的账是纯负的——登记了上游 URL 与 sha256 要维护，却只提供三行 div，
 * 而且早已改得和上游对不上。2026-10-20 收回自己名下，`UPSTREAM.json` 里的条目一并删掉。
 *
 * 保留 `data-sidebar` 属性：目前没有代码依赖它，但它是 shadcn sidebar 的契约，
 * 将来真要换成官方那套时不用再动这里。
 */
export const SidebarHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => <div ref={ref} data-sidebar="header"
    className={cn('flex flex-col gap-2 p-2', className)} {...props} />,
);
SidebarHeader.displayName = 'SidebarHeader';

export const SidebarContent = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => <div ref={ref} data-sidebar="content"
    className={cn('flex min-h-0 flex-1 flex-col gap-2 overflow-auto', className)} {...props} />,
);
SidebarContent.displayName = 'SidebarContent';

export const SidebarFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => <div ref={ref} data-sidebar="footer"
    className={cn('flex flex-col gap-2 p-2', className)} {...props} />,
);
SidebarFooter.displayName = 'SidebarFooter';
