import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { ThemeProvider } from '@/components/ThemeProvider';

export const metadata: Metadata = {
  title: "MathMover - 让数学几何动起来",
  description: "AI 驱动的数学题目动态演示生成器，秒级将几何题转化为交互式课件。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="scroll-smooth" suppressHydrationWarning>
      <body className="font-sans antialiased"><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
