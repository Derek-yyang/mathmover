import type { ReactNode } from 'react';
import '../../app/globals.css';
import 'katex/dist/katex.min.css';
import { ThemeProvider } from '@/components/ThemeProvider';

export const metadata = { title: 'MathMover · 在线体验', description: '把数学问题变成可探索的图形。' };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN" suppressHydrationWarning><body><ThemeProvider>{children}</ThemeProvider></body></html>;
}
