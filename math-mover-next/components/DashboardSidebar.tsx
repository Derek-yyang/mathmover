"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, PanelLeftClose, PanelLeftOpen, SquarePen, Settings2, Plus } from 'lucide-react';
import { useSidebarState } from './dashboard/SidebarState';
import SidebarRailButton from './dashboard/SidebarRailButton';
import SettingsModal from './SettingsModal';
import CoursewareThreadList from './dashboard/CoursewareThreadList';
import { useNewCourseware } from '@/hooks/useNewCourseware';
import { signalBoardResizePreview } from '@/lib/board-resize-preview';
import { OPEN_SETTINGS_EVENT } from '@/lib/settings-navigation';
import { ThreadListSidebar } from './assistant-ui/elements/threadlist-sidebar.aui';

const iconButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--mm-text-stone-600)] hover:bg-[var(--mm-bg-stone-200)]/60 hover:text-[var(--mm-text-stone-900)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]';
const rowButton = 'flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-[var(--mm-text-stone-600)] hover:bg-[var(--mm-bg-stone-200)]/50 hover:text-[var(--mm-text-stone-900)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]';

export default function DashboardSidebar() {
  const pathname = usePathname();
  const newCourseware = useNewCourseware();
  const sidebar = useSidebarState();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);
  const resizePreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDashboard = pathname === '/dashboard';

  useEffect(() => {
    const open = () => setIsSettingsOpen(true);
    window.addEventListener(OPEN_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open);
  }, []);

  const beginSidebarResizePreview = () => {
    signalBoardResizePreview('sidebar', true);
    if (resizePreviewTimer.current) clearTimeout(resizePreviewTimer.current);
    resizePreviewTimer.current = setTimeout(() => {
      resizePreviewTimer.current = null;
      signalBoardResizePreview('sidebar', false);
    }, 300);
  };

  useEffect(() => () => {
    if (resizePreviewTimer.current) clearTimeout(resizePreviewTimer.current);
    signalBoardResizePreview('sidebar', false);
  }, []);

  return (
    <>
      <div className="dashboard-sidebar relative z-30 h-full shrink-0 bg-[var(--mm-canvas-shell)]" data-collapsed={sidebar?.collapsed ? 'true' : 'false'}>
        <aside aria-label="快捷侧栏" aria-hidden={!sidebar?.collapsed} inert={!sidebar?.collapsed}
          className="sidebar-rail absolute inset-y-0 left-0 flex w-14 flex-col items-center border-r border-[var(--mm-border-stone-200)] bg-[var(--mm-canvas-shell)]">
          <div className="flex h-14 shrink-0 items-center">
            <SidebarRailButton id={sidebar?.openButtonId} label="展开侧栏" controls={sidebar?.sidebarId} expanded={false} onClick={() => { beginSidebarResizePreview(); sidebar?.toggleSidebar(); }}>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--mm-bg-emerald-700)] text-sm font-bold text-white group-hover:hidden group-focus-visible:hidden">M</span>
              <PanelLeftOpen className="hidden h-5 w-5 group-hover:block group-focus-visible:block" />
            </SidebarRailButton>
          </div>
          {isDashboard && <div className="flex flex-col gap-1">
            <SidebarRailButton label="新建课件" onClick={newCourseware}><SquarePen className="h-5 w-5" /></SidebarRailButton>
            <SidebarRailButton label="搜索课件"  onClick={() => {
              setSearchRequest(value => value + 1);
              if (sidebar?.collapsed) beginSidebarResizePreview();
              sidebar?.expandSidebar();
            }}><Search className="h-5 w-5" /></SidebarRailButton>
          </div>}
          <div className="mt-auto py-2">
            <SidebarRailButton label="设置" onClick={() => setIsSettingsOpen(true)}><Settings2 className="h-5 w-5" /></SidebarRailButton>
          </div>
        </aside>
      <div className="sidebar-expanded-clip absolute inset-0 overflow-hidden" inert={sidebar?.collapsed} aria-hidden={sidebar?.collapsed}>
      <ThreadListSidebar id={sidebar?.sidebarId} aria-label="课件侧栏"
        className="sidebar-expanded w-64 border-r border-[var(--mm-border-stone-200)]"
        header={<>
          <Link href="/" className="mr-auto flex min-w-0 items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]" aria-label="MathMover 首页">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--mm-bg-emerald-600)] text-sm font-bold text-white">M</span>
            <span className="text-sm font-semibold text-[var(--mm-text-stone-900)]">MathMover</span>
          </Link>
          {/* 桌面端：品牌在应用标题栏，主操作「新建课件」常驻头部（列表里的新建行隐藏）；
              网页版保留品牌链接与列表里的新建行。 */}
          <button type="button" onClick={newCourseware}
            className="desktop-sidebar-new mr-auto h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-[var(--mm-text-stone-800)] hover:bg-[var(--mm-bg-stone-100)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]">
            <Plus aria-hidden className="h-4 w-4 text-[var(--mm-text-emerald-700)]" />
            新建课件
          </button>
          {sidebar && <button id={sidebar.closeButtonId} type="button" className={iconButton} aria-label="收起侧栏" title="收起侧栏"
            aria-expanded={true} aria-controls={sidebar.sidebarId} onClick={() => { beginSidebarResizePreview(); sidebar.toggleSidebar(); }}>
            <PanelLeftClose className="h-4 w-4" />
          </button>}
        </>}
        footer={<>
          <button type="button" onClick={() => setIsSettingsOpen(true)} className={rowButton}><Settings2 aria-hidden className="h-4 w-4 shrink-0 text-[var(--mm-text-stone-500)]" /><span>设置</span></button>
        </>}>
        {isDashboard ? <CoursewareThreadList searchRequest={searchRequest} /> : <div className="flex-1" />}

      </ThreadListSidebar>
      </div>
      </div>

      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </>
  );
}
