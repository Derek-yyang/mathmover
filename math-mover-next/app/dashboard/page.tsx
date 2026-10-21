import DashboardClient from './DashboardClient';

// 必须每请求渲染：wsUrl 来自运行时环境（桌面壳会挑一个空闲端口），
// 静态预渲染会把构建机上的默认值烧进 HTML。
export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  const port = process.env.MATHMOVER_WS_PORT?.trim();
  const wsUrl = process.env.MATHMOVER_WS_URL?.trim() || `ws://127.0.0.1:${port || '8787'}`;
  return <DashboardClient wsUrl={wsUrl} />;
}
