import { Suspense } from 'react';
import DashboardSidebar from '../../components/DashboardSidebar';
import PageTransition from '../../components/PageTransition';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen w-full bg-[#FDFCF8] overflow-hidden">
        {/* 左侧静态侧边栏 */}
        <Suspense fallback={null}>
        <DashboardSidebar />
        </Suspense>
        
        {/* 右侧动态内容区 */}
        <div className="flex-1 relative h-full overflow-hidden">
            <Suspense fallback={null}>
                <PageTransition>
                    {children}
                </PageTransition>
            </Suspense>
        </div>
    </div>
  );
}
