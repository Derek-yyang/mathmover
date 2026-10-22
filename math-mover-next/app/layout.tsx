import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { ThemeProvider } from '@/components/ThemeProvider';
import { DesktopTitleBar } from '@/components/dashboard/DesktopTitleBar';

export const metadata: Metadata = {
  title: "MathMover - 让数学几何动起来",
  description: "AI 驱动的数学题目动态演示生成器，秒级将几何题转化为交互式课件。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 桌面构建时注入 MATHMOVER_DESKTOP=1（见 desktop/scripts/prepare.mjs）：
  // 隐藏了系统标题栏，这里补一条应用内标题栏并给内容让出 40px。网页版不受影响。
  const desktop = process.env.MATHMOVER_DESKTOP === '1';
  return (
    <html lang="zh-CN" className="scroll-smooth" data-desktop={desktop ? '1' : undefined} data-desktop-platform={desktop ? process.platform : undefined} suppressHydrationWarning>
      <head>
        {/* Use our native themes without extension mutations before hydration. */}
        <meta name="darkreader-lock" />
      </head>
      <body className="font-sans antialiased"><ThemeProvider>
        <div className="flex min-h-dvh flex-col">
          {desktop && <DesktopTitleBar enabled />}
          {/* 标题栏是 fixed，用同高占位把它让出的 40px 放进文档流；不要用 padding，
              否则 box-sizing 会在 min-h-dvh 之外再加 40px，整页滚动。 */}
          {desktop && <div aria-hidden className="h-10 shrink-0" />}
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
      </ThemeProvider></body>
    </html>
  );
}
