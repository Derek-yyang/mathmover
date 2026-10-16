import { Suspense } from 'react';
import DashboardSidebar from '../../components/DashboardSidebar';
import { SidebarStateProvider } from '@/components/dashboard/SidebarState';
import { AgentRuntimeProvider } from '@/components/dashboard/AgentRuntimeState';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarStateProvider>
      <AgentRuntimeProvider>
      <div className="flex h-screen w-full bg-[var(--mm-canvas-shell)] overflow-hidden">
        {/* 左侧固定宽度侧栏，可收起，不拖动宽度。 */}
        <Suspense fallback={null}>
          <DashboardSidebar />
        </Suspense>
        {/* 右侧动态内容区 */}
        <div className="flex-1 relative h-full min-w-0 overflow-hidden">
          <Suspense fallback={null}>
            {/* 交互画布不能在缩放动画中初始化，否则引擎会缓存错误的像素比例。 */}
            {children}
          </Suspense>
        </div>
      </div>
      </AgentRuntimeProvider>
    </SidebarStateProvider>
  );
}
