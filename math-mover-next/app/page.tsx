"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowLeft, Cuboid, Leaf, Check, Zap, Crown, Rocket, ScanEye, Box, MousePointerClick, Cpu, FileUp, Github, Star, Download } from "lucide-react";
import { motion } from 'framer-motion';

import dynamic from 'next/dynamic';

const GeoGebraBoard = dynamic(() => import('@/components/GeoGebraBoard'), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center bg-[var(--mm-bg-stone-50)] text-[var(--mm-text-stone-400)] font-bold">加载画板中...</div>
});

export default function LandingPage() {
  const [activeShowcase, setActiveShowcase] = useState(0);
  const [ggbApplet, setGgbApplet] = useState<any>(null);

  const BILIBILI_BV_ID = "BV1Xsz4BtEtJ"; // 这里填你的BV号

  const showcaseCases = [
      {
          title: "解析几何：椭圆动点",
          desc: "动态追踪椭圆上的点与焦点构成的三角形面积变化。",
          image: "/cases/case1.png",
          mode: '2D',
          commands: `
MODE: 2D
ShowAxes(1, true)
O = (0, 0)
SetFixed(O, true)
ShowLabel(O, true)
SetLabelMode(O, 1)
A = (-2, 0)
SetFixed(A, true)
ShowLabel(A, true)
SetLabelMode(A, 1)
B = (0, -1)
SetFixed(B, true)
ShowLabel(B, true)
SetLabelMode(B, 1)
F1 = (-1.73205, 0)
SetFixed(F1, true)
SetColor(F1, "Black")
SetPointSize(F1, 4)
ShowLabel(F1, true)
SetLabelMode(F1, 1)
SetVisibleInView(F1, 1, true)
F2 = (1.73205, 0)
SetFixed(F2, true)
SetColor(F2, "Black")
SetPointSize(F2, 4)
ShowLabel(F2, true)
SetLabelMode(F2, 1)
SetVisibleInView(F2, 1, true)
ellC = Ellipse(F1, F2, 2)
SetColor(ellC, "Black")
P = (-1.73205, 0.5)
SetFixed(P, true)
ShowLabel(P, true)
SetLabelMode(P, 1)
VR = (2, 0)
VT = (0, 1)
arcM = Arc(ellC, VR, VT)
SetVisibleInView(VR, 1, false)
SetVisibleInView(VT, 1, false)
SetColor(arcM, "Red")
t = Slider(0.01, 0.99, 0.01)
M = Point(arcM, t)
SetColor(M, "Red")
ShowLabel(M, true)
SetLabelMode(M, 1)
lMB = Line(M, B)
SetColor(lMB, "Blue")
ShowLabel(lMB, true)
lMA = Line(M, A)
SetColor(lMA, "Blue")
ShowLabel(lMA, true)
C = Intersect(lMB, xAxis)
ShowLabel(C, true)
SetLabelMode(C, 1)
D = Intersect(lMA, yAxis)
ShowLabel(D, true)
SetLabelMode(D, 1)
triOCD = Polygon(O, C, D)
SetColor(triOCD, "LightBlue")
SetFilling(triOCD, 0.3)
ShowLabel(triOCD, true)
          `
      },
      {
          title: "二次函数：最值问题",
          desc: "拖动区间端点，直观观察函数在特定区间内的最大最小值。",
          image: "/cases/case2.png",
          mode: '2D',
          commands: `
MODE: 2D
ShowAxes(1, true)
ShowGrid(1, true)
A = (0, 3)
SetFixed(A, true)
ShowLabel(A, true)
SetLabelMode(A, 1)
B = (-1, 0)
SetFixed(B, true)
ShowLabel(B, true)
SetLabelMode(B, 1)
D = (2, 3)
SetFixed(D, true)
ShowLabel(D, true)
SetLabelMode(D, 1)
C = (1, 0)
SetFixed(C, true)
ShowLabel(C, true)
SetLabelMode(C, 1)
polyABCD = Polygon(A, B, C, D)
SetFilling(polyABCD, 0.2)
SetColor(polyABCD, "Blue")
f(x) = -x^2 + 2x + 3
E = (3, 0)
SetFixed(E, true)
ShowLabel(E, true)
SetLabelMode(E, 1)
M = (0.5, 1.5)
l = Line(E, M)
SetColor(l, "Black")
F = (-0.4, 2.04)
SetFixed(F, true)
ShowLabel(F, true)
SetLabelMode(F, 1)
t = Slider(-0.4, 3, 0.01)
P = (t, f(t))
SetColor(P, "Red")
ShowLabel(P, true)
SetLabelMode(P, 1)
polyPFE = Polygon(P, F, E)
SetFilling(polyPFE, 0.3)
SetColor(polyPFE, "Green")
segPA = Segment(P, A)
segAE = Segment(A, E)
segEP = Segment(E, P)
SetLineStyle(segPA, "Dashed")
SetLineStyle(segAE, "Dashed")
SetLineStyle(segEP, "Dashed")
SetColor(segPA, "Gray")
SetColor(segAE, "Gray")
SetColor(segEP, "Gray")
O = (0, 0)
SetFixed(O, true)
ShowLabel(O, true)
SetLabelMode(O, 1)
          `
      },
      {
          title: "立体几何：截面轨迹",
          desc: "旋转正方体，观察平面截割产生的截面形状变化。",
          image: "/cases/case3.png",
          mode: '3D',
          commands: `
MODE: 3D
A = Point({2, 0, 0})
SetFixed(A, true)
ShowLabel(A, true)
SetLabelMode(A, 1)
SetColor(A, "Blue")
B = Point({2, 2, 0})
SetFixed(B, true)
ShowLabel(B, true)
SetLabelMode(B, 1)
SetColor(B, "Blue")
C = Point({0, 2, 0})
SetFixed(C, true)
ShowLabel(C, true)
SetLabelMode(C, 1)
SetColor(C, "Blue")
D = Point({0, 0, 0})
SetFixed(D, true)
ShowLabel(D, true)
SetLabelMode(D, 1)
SetColor(D, "Blue")
A_1 = Point({2, 0, 2})
SetFixed(A_1, true)
ShowLabel(A_1, true)
SetLabelMode(A_1, 1)
SetColor(A_1, "Blue")
B_1 = Point({2, 2, 2})
SetFixed(B_1, true)
ShowLabel(B_1, true)
SetLabelMode(B_1, 1)
SetColor(B_1, "Blue")
C_1 = Point({0, 2, 2})
SetFixed(C_1, true)
ShowLabel(C_1, true)
SetLabelMode(C_1, 1)
SetColor(C_1, "Blue")
D_1 = Point({0, 0, 2})
SetFixed(D_1, true)
ShowLabel(D_1, true)
SetLabelMode(D_1, 1)
SetColor(D_1, "Blue")
E = Point({1, 2, 0})
SetFixed(E, true)
ShowLabel(E, true)
SetLabelMode(E, 1)
SetColor(E, "Blue")
G = Point({0, 2, 1})
SetFixed(G, true)
ShowLabel(G, false)
M = Point({1, 2, 2})
SetFixed(M, true)
ShowLabel(M, false)
N = Point({2, 2, 1})
SetFixed(N, true)
ShowLabel(N, false)
s1 = Segment(A, B)
s2 = Segment(B, C)
s3 = Segment(C, D)
s4 = Segment(D, A)
s5 = Segment(A_1, B_1)
s6 = Segment(B_1, C_1)
s7 = Segment(C_1, D_1)
s8 = Segment(D_1, A_1)
s9 = Segment(A, A_1)
s10 = Segment(B, B_1)
s11 = Segment(C, C_1)
s12 = Segment(D, D_1)
poly1 = Polygon(A, D_1, G, E)
SetColor(poly1, "Cyan")
SetFilling(poly1, 0.25)
path = Segment(M, N)
SetLineStyle(path, 2)
SetColor(path, "Red")
F = Point(path)
ShowLabel(F, true)
SetLabelMode(F, 1)
SetColor(F, "Red")
sF = Segment(A_1, F)
SetLineStyle(sF, 2)
SetColor(sF, "Black")
          `
      }
  ];

  // 封装绘图逻辑
  const drawCase = (index: number, apiInstance?: any) => {
    const ggb = apiInstance || ggbApplet;
    if (!ggb) return;
    const currentCase = showcaseCases[index];
    
    if (currentCase.commands) {
        try {
            // 1. 清空当前画布
            if (typeof ggb.newConstruction === 'function') {
                ggb.newConstruction();
            } else {
                console.warn("newConstruction is not a function, clearing with fallback");
            }
            
            // 2. 根据新案例的维度切换视图
            if (currentCase.mode === '3D') {
                ggb.setPerspective("T"); 
            } else {
                ggb.setPerspective("G"); 
            }
            
            // 3. 执行新案例的指令
            const commands = currentCase.commands.split('\n').filter(line => line.trim() !== '');
            commands.forEach(cmd => {
                ggb.evalCommand(cmd);
            });
            
            // 4. 重置视图并刷新
            if (currentCase.mode !== '3D') {
                ggb.evalCommand('CenterView((0,0))');
            }
            
            // 延迟刷新以确保渲染
            setTimeout(() => {
                if (ggb.recalcDisplay && typeof ggb.recalcDisplay === 'function') {
                    ggb.recalcDisplay();
                }
            }, 50);
            
        } catch (e) {
            console.error("GGB Render Error:", e);
        }
    }
  };

  // 解决 GeoGebra 切换卡顿：利用全局实例进行重绘，避免组件卸载
  useEffect(() => {
      if (ggbApplet) {
          drawCase(activeShowcase);
      }
  }, [activeShowcase, ggbApplet]);

  return (
    <div className="min-h-screen bg-[var(--mm-canvas-shell)] text-[var(--mm-text-stone-800)] font-sans selection:bg-[var(--mm-bg-emerald-100)] selection:text-[var(--mm-text-emerald-900)] relative overflow-x-hidden">
      
      {/* Organic Ambience (Absolute) */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Natural Glows */}
        <div className="absolute top-[-10%] left-[-5%] w-[45%] h-[45%] bg-[var(--mm-bg-emerald-100)]/40 rounded-full blur-[120px] mix-blend-multiply animate-pulse-slow"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-[var(--mm-bg-lime-100)]/40 rounded-full blur-[100px] mix-blend-multiply animate-pulse-slow delay-1000"></div>
        
        {/* Floating Shapes/Doodles - Green Theme */}
        <div className="absolute top-32 left-12 opacity-40 hidden lg:block animate-bounce-slow">
            <div className="w-12 h-12 border-4 border-dashed border-[var(--mm-border-emerald-300)] rounded-full rotate-12"></div>
        </div>
        <div className="absolute bottom-40 right-24 opacity-40 hidden lg:block animate-bounce-slow delay-500">
            <div className="w-16 h-16 border-4 border-dashed border-[var(--mm-border-teal-300)] rotate-45 transform skew-x-12"></div>
        </div>
        {/* Hand-drawn style arrow using CSS borders */}
        <div className="absolute top-44 right-[18%] opacity-30 hidden xl:block rotate-6">
            <div className="w-20 h-20 border-t-4 border-r-4 border-[var(--mm-border-emerald-400)] rounded-tr-[3rem]"></div>
        </div>
      </div>

      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 transition-all duration-300 bg-[var(--mm-canvas-shell)]/80 backdrop-blur-md border-b border-[var(--mm-border-stone-200)]/50">
        <div className="w-full max-w-[1440px] mx-auto px-10 h-20 flex items-center justify-between">
          {/* Logo Section */}
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-gradient-to-br from-[var(--mm-bg-emerald-500)] to-[var(--mm-bg-green-600)] rounded-xl flex items-center justify-center text-white font-black text-xl shadow-[4px_4px_0px_0px_rgba(16,185,129,0.2)] transform -rotate-2 hover:rotate-0 transition-transform">
              M
            </div>
            <span className="font-bold text-xl tracking-tight text-[var(--mm-text-stone-800)]">
              MathMover
            </span>
          </div>

          {/* Center Navigation - Premium Look */}
          <div className="hidden md:flex items-center gap-10 absolute left-1/2 transform -translate-x-1/2">
            <Link href="#features" scroll={true} className="text-sm font-medium text-[var(--mm-text-stone-600)] hover:text-[var(--mm-text-emerald-600)] transition-colors relative group">
              功能特性
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[var(--mm-bg-emerald-600)] transition-all duration-300 group-hover:w-full rounded-full opacity-80"></span>
            </Link>
            <Link href="#showcase" scroll={true} className="text-sm font-medium text-[var(--mm-text-stone-600)] hover:text-[var(--mm-text-emerald-600)] transition-colors relative group">
              案例展示
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[var(--mm-bg-emerald-600)] transition-all duration-300 group-hover:w-full rounded-full opacity-80"></span>
            </Link>
            <Link href="#pricing" scroll={true} className="text-sm font-medium text-[var(--mm-text-stone-600)] hover:text-[var(--mm-text-emerald-600)] transition-colors relative group">
              开源免费
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-[var(--mm-bg-emerald-600)] transition-all duration-300 group-hover:w-full rounded-full opacity-80"></span>
            </Link>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            <a
              href="#github"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-[var(--mm-border-stone-200)] bg-[var(--mm-surface)]/90 text-[var(--mm-text-stone-700)] text-sm font-semibold hover:border-[var(--mm-border-stone-300)] hover:bg-[var(--mm-bg-stone-50)] transition-all shadow-sm hover:shadow active:scale-95 group"
            >
              <Github className="w-4 h-4 text-[var(--mm-text-stone-700)] group-hover:text-[var(--mm-text-stone-900)] transition-colors" />
              <span>GitHub</span>
              <span className="inline-flex items-center gap-1 text-xs text-[var(--mm-text-stone-400)] bg-[var(--mm-bg-stone-100)] px-2 py-0.5 rounded-full group-hover:text-[var(--mm-text-amber-500)] group-hover:bg-[var(--mm-bg-amber-50)] transition-colors">
                <Star className="w-3 h-3 fill-current text-[var(--mm-text-amber-400)]" />
                Star
              </span>
            </a>
            <Link
              href="/dashboard"
              className="px-6 py-2.5 rounded-full font-bold text-white bg-[var(--mm-bg-emerald-500)] hover:bg-[var(--mm-bg-emerald-600)] shadow-sm hover:shadow-md hover:-translate-y-[1px] transition-all active:scale-95"
            >
              在线试用
            </Link>
          </div>
        </div>
      </nav>
 
      {/* Hero Section */}
      <section className="relative pt-44 pb-32 z-10">
        <div className="max-w-5xl mx-auto px-6 text-center">
          
          {/* Organic Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[var(--mm-bg-emerald-50)] border border-[var(--mm-border-emerald-100)] text-[var(--mm-text-emerald-700)] text-sm font-bold mb-8 animate-fade-in-up transform -rotate-1 hover:rotate-0 transition-transform cursor-default shadow-sm">
            <Leaf className="w-3.5 h-3.5 fill-emerald-100" />
            <span>播种逻辑思维的种子</span>
          </div>
 
          {/* Headline */}
          <h1 className="text-6xl sm:text-7xl font-black tracking-tight text-[var(--mm-text-stone-800)] mb-8 leading-[1.1] text-center w-full pl-2">
            让数学可视化，<br className="hidden sm:block" />
            <span className="relative inline-block text-[var(--mm-text-emerald-600)]">
              仅需数秒
              {/* Underline scribble - Green */}
              <svg className="absolute w-full h-3 -bottom-2 left-0 text-[var(--mm-text-emerald-300)] fill-transparent stroke-current stroke-[4]" viewBox="0 0 100 10" preserveAspectRatio="none">
                 <path d="M0 5 Q 50 12 100 5" />
              </svg>
            </span>
          </h1>
 
          <p className="text-xl text-[var(--mm-text-stone-500)] mb-12 max-w-2xl mx-auto leading-relaxed font-medium">
            一个有生命力的创作空间，让抽象问题绽放为交互式几何。
            上传一张快照，让我们的 AI 将其培育为动态的 GeoGebra 画布。
          </p>
 
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20 sm:mb-24">
            <Link
              href="/dashboard"
              className="w-full sm:w-auto px-8 py-4 rounded-full font-bold text-white bg-[var(--mm-bg-emerald-500)] hover:bg-[var(--mm-bg-emerald-600)] shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group"
            >
              <span>在线试用 (Web Demo)</span>
              <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <a
              href="#releases"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-8 py-4 bg-[var(--mm-surface)] text-[var(--mm-text-stone-700)] border-2 border-[var(--mm-border-stone-200)] rounded-full font-bold text-lg hover:border-[var(--mm-border-emerald-500)] hover:text-[var(--mm-text-emerald-600)] transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <Download className="w-5 h-5 text-[var(--mm-text-emerald-600)]" />
              <span>下载桌面端</span>
            </a>
          </div>

          {/* Visual Center - Paper Card */}
          <div className="relative max-w-4xl mx-auto">
            {/* Background rotation accent - Earthy Tones */}
            <div className="absolute inset-0 bg-[var(--mm-bg-softgreen-1)] rounded-[2.5rem] transform rotate-2 scale-105 opacity-80"></div>
            <div className="absolute inset-0 bg-[var(--mm-bg-softgreen-2)] rounded-[2.5rem] transform -rotate-1 scale-105 opacity-80"></div>
            
            <div id="demo" className="relative bg-[var(--mm-surface)] rounded-[2rem] border-2 border-[var(--mm-border-stone-100)] shadow-xl overflow-hidden p-4 transform transition-transform hover:scale-[1.01] duration-500">
              <div className="bg-black rounded-[1.5rem] overflow-hidden aspect-video relative shadow-inner border border-[var(--mm-border-stone-200)]">
                <iframe 
                    src={`//player.bilibili.com/player.html?bvid=${BILIBILI_BV_ID}&page=1&high_quality=1&danmaku=0`}
                    className="w-full h-full rounded-[1.5rem]"
                    scrolling="no" 
                    frameBorder="0" 
                    allowFullScreen={true}
                ></iframe>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Grid - Bento Style */}
      <section className="py-24 relative z-10" id="features">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-16 space-y-4">
              <h2 className="text-4xl md:text-5xl font-black text-[var(--mm-text-stone-800)] tracking-tight">
                  不仅是工具，<br/>更是思维的延伸
              </h2>
              <p className="text-[var(--mm-text-stone-500)] font-bold text-lg max-w-2xl mx-auto">
                  五大核心引擎，重塑数学探索体验
              </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-6 grid-rows-[auto_auto_auto] md:grid-rows-[320px_280px]">
            {/* ... Feature Cards ... */}
            {/* Feature A: AI Vision (Large Card) - 2 cols, 2 rows */}
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="md:col-span-4 md:row-span-1 bg-[var(--mm-surface)] rounded-[2rem] p-8 md:p-10 border border-[var(--mm-border-stone-100)] shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group flex flex-col justify-between"
            >
                <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--mm-bg-emerald-50)] rounded-full blur-[80px] -mr-20 -mt-20 group-hover:bg-[var(--mm-bg-emerald-100)] transition-colors"></div>
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: "radial-gradient(#10b981 1px, transparent 1px)", backgroundSize: "24px 24px" }}></div>

                <div className="relative z-10">
                    <div className="w-14 h-14 bg-[var(--mm-bg-emerald-50)] rounded-2xl flex items-center justify-center mb-6 border border-[var(--mm-border-emerald-100)] group-hover:rotate-6 transition-transform duration-300">
                        <ScanEye className="w-7 h-7 text-[var(--mm-text-emerald-600)]" />
                    </div>
                    <h3 className="text-2xl font-black text-[var(--mm-text-stone-800)] mb-3">AI 视觉解析：从快照到逻辑</h3>
                    <p className="text-[var(--mm-text-stone-500)] font-medium leading-relaxed max-w-lg">
                        强大的 AI 视觉引擎，不仅能看懂题目，更能读懂隐含的几何约束。无论是手写草稿还是书本截图，瞬间将其转化为可运行的严谨代码。
                    </p>
                </div>
                <div className="mt-8 flex gap-2">
                   <div className="px-3 py-1 bg-[var(--mm-bg-stone-50)] rounded-lg text-xs font-bold text-[var(--mm-text-stone-400)] border border-[var(--mm-border-stone-100)]">OCR 识别</div>
                   <div className="px-3 py-1 bg-[var(--mm-bg-stone-50)] rounded-lg text-xs font-bold text-[var(--mm-text-stone-400)] border border-[var(--mm-border-stone-100)]">语义理解</div>
                   <div className="px-3 py-1 bg-[var(--mm-bg-stone-50)] rounded-lg text-xs font-bold text-[var(--mm-text-stone-400)] border border-[var(--mm-border-stone-100)]">代码生成</div>
                </div>
            </motion.div>

            {/* Feature B: 2D & 3D (Medium Card) - 2 cols, 1 row */}
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="md:col-span-2 md:row-span-1 bg-[var(--mm-surface)] rounded-[2rem] p-8 border border-[var(--mm-border-stone-100)] shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group flex flex-col"
            >
                <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--mm-bg-teal-50)] rounded-full blur-[60px] -mr-10 -mt-10 group-hover:bg-[var(--mm-bg-teal-100)] transition-colors"></div>
                
                <div className="relative z-10">
                    <div className="w-12 h-12 bg-[var(--mm-bg-teal-50)] rounded-2xl flex items-center justify-center mb-6 border border-[var(--mm-border-teal-100)] group-hover:-rotate-6 transition-transform duration-300">
                        <Box className="w-6 h-6 text-[var(--mm-text-teal-600)]" />
                    </div>
                    <h3 className="text-xl font-black text-[var(--mm-text-stone-800)] mb-3">全维度引擎</h3>
                    <p className="text-[var(--mm-text-stone-500)] font-medium text-sm leading-relaxed">
                        无论是复杂的函数曲线，还是精密的立体几何动点，我们都能完美渲染。2D 与 3D 无缝切换。
                    </p>
                </div>
            </motion.div>

            {/* Feature C: Interactive (Medium Card) - 2 cols, 1 row */}
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.2 }}
                className="md:col-span-2 md:row-span-1 bg-[var(--mm-surface)] rounded-[2rem] p-8 border border-[var(--mm-border-stone-100)] shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group flex flex-col"
            >
                 <div className="absolute bottom-0 left-0 w-32 h-32 bg-[var(--mm-bg-lime-50)] rounded-full blur-[60px] -ml-10 -mb-10 group-hover:bg-[var(--mm-bg-lime-100)] transition-colors"></div>

                <div className="relative z-10">
                    <div className="w-12 h-12 bg-[var(--mm-bg-lime-50)] rounded-2xl flex items-center justify-center mb-6 border border-[var(--mm-border-lime-100)] group-hover:scale-110 transition-transform duration-300">
                        <MousePointerClick className="w-6 h-6 text-[var(--mm-text-lime-600)]" />
                    </div>
                    <h3 className="text-xl font-black text-[var(--mm-text-stone-800)] mb-3">交互式课件</h3>
                    <p className="text-[var(--mm-text-stone-500)] font-medium text-sm leading-relaxed">
                        自动生成动态滑块，拖动即可观察动点轨迹，拒绝死板，让数学逻辑在眼前跳动。
                    </p>
                </div>
            </motion.div>

            {/* Feature D: Geek Mode (Small Card) - 2 cols, 1 row */}
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 }}
                className="md:col-span-2 md:row-span-1 bg-[var(--mm-surface)] rounded-[2rem] p-8 border border-[var(--mm-border-stone-100)] shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group flex flex-col"
            >
                <div className="absolute top-0 right-0 w-24 h-24 bg-[var(--mm-bg-orange-50)] rounded-full blur-[50px] -mr-8 -mt-8 group-hover:bg-[var(--mm-bg-orange-100)] transition-colors"></div>

                <div className="relative z-10">
                    <div className="w-12 h-12 bg-[var(--mm-bg-orange-50)] rounded-2xl flex items-center justify-center mb-6 border border-[var(--mm-border-orange-100)] group-hover:rotate-12 transition-transform duration-300">
                        <Cpu className="w-6 h-6 text-[var(--mm-text-orange-600)]" />
                    </div>
                    <h3 className="text-xl font-black text-[var(--mm-text-stone-800)] mb-3">BYOK 极客模式</h3>
                    <p className="text-[var(--mm-text-stone-500)] font-medium text-sm leading-relaxed">
                        支持 DeepSeek、GPT-4 等模型接入，彻底解决成本焦虑，实现离线级隐私保护。
                    </p>
                </div>
            </motion.div>

            {/* Feature E: Export (Small Card) - 2 cols, 1 row */}
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 }}
                className="md:col-span-2 md:row-span-1 bg-[var(--mm-surface)] rounded-[2rem] p-8 border border-[var(--mm-border-stone-100)] shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group flex flex-col"
            >
                <div className="absolute bottom-0 right-0 w-24 h-24 bg-[var(--mm-bg-blue-50)] rounded-full blur-[50px] -mr-8 -mb-8 group-hover:bg-[var(--mm-bg-blue-100)] transition-colors"></div>

                <div className="relative z-10">
                    <div className="w-12 h-12 bg-[var(--mm-bg-blue-50)] rounded-2xl flex items-center justify-center mb-6 border border-[var(--mm-border-blue-100)] group-hover:-translate-y-1 transition-transform duration-300">
                        <FileUp className="w-6 h-6 text-[var(--mm-text-blue-600)]" />
                    </div>
                    <h3 className="text-xl font-black text-[var(--mm-text-stone-800)] mb-3">一键全平台导出</h3>
                    <p className="text-[var(--mm-text-stone-500)] font-medium text-sm leading-relaxed">
                        支持导出独立网页文件，无需环境，有浏览器就能在课堂演示。
                    </p>
                </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Showcase Section - Dynamic Demo */}
      <section className="py-24 relative z-10" id="showcase">
          <div className="max-w-6xl mx-auto px-6">
              <div className="text-center mb-16 space-y-4">
                  <h2 className="text-4xl md:text-5xl font-black text-[var(--mm-text-stone-800)] tracking-tight">
                      生成案例展示
                  </h2>
                  <p className="text-[var(--mm-text-stone-500)] font-bold text-lg max-w-2xl mx-auto">
                      无需猜测，直接上手。点击左侧案例，体验 AI 如何精准捕捉几何逻辑。
                  </p>
              </div>

              <div className="flex flex-col lg:flex-row gap-8 items-stretch h-[600px] lg:h-[500px]">
                  
                  {/* Left Navigation */}
                  <div className="w-full lg:w-1/3 flex flex-col gap-4">
                      {showcaseCases.map((item, index) => (
                          <div 
                              key={index}
                              onClick={() => setActiveShowcase(index)}
                              className={`p-6 rounded-2xl border-2 cursor-pointer transition-all duration-300 flex-1 flex flex-col justify-center ${
                                  activeShowcase === index 
                                    ? "bg-[var(--mm-surface)] border-[var(--mm-border-emerald-500)] shadow-lg scale-[1.02]"
                                    : "bg-[var(--mm-surface)]/50 border-[var(--mm-border-stone-100)] hover:border-[var(--mm-border-emerald-200)] hover:bg-[var(--mm-surface)]"
                              }`}
                          >
                              <h3 className={`font-black text-lg mb-2 ${activeShowcase === index ? "text-[var(--mm-text-emerald-700)]" : "text-[var(--mm-text-stone-600)]"}`}>
                                  {item.title}
                              </h3>
                              <p className="text-sm text-[var(--mm-text-stone-400)] font-medium leading-relaxed">
                                  {item.desc}
                              </p>
                          </div>
                      ))}
                  </div>

                  {/* Right Stage (Main GeoGebra Area) */}
                  <div className="w-full lg:w-2/3 bg-[var(--mm-bg-stone-800)] rounded-[2rem] p-3 shadow-2xl flex relative overflow-hidden ring-8 ring-[var(--mm-border-stone-900)]/5">
                      {/* Tablet Frame */}
                      <div className="w-full h-full bg-[var(--mm-bg-stone-100)] rounded-[1.5rem] overflow-hidden relative group">
                          
                          {/* Main Content: GeoGebra Board (Full Size) */}
                          <div className="absolute inset-0 z-0">
                              <GeoGebraBoard 
                                  key="showcase-ggb-static" 
                                  id="showcase-ggb"
                                  width={800} 
                                  height={600}
                                  showToolbar={false}
                                  showAlgebraInput={false}
                                  showMenuBar={false}
                                  enableShiftDragZoom={true}
                                  materialId="" 
                                  ggbBase64=""
                                  onAppletReady={(api) => {
                                      setGgbApplet(api);
                                      drawCase(activeShowcase, api);
                                  }}
                              />
                          </div>

                          {/* Floating Reference Image (Picture-in-Picture) */}
                          <div className="absolute bottom-6 left-6 z-10 max-w-[240px] max-h-[180px] bg-[var(--mm-surface)] p-2 rounded-lg shadow-2xl border-4 border-[var(--mm-border-white)] transform transition-transform duration-300 hover:scale-[2] hover:z-50 origin-bottom-left cursor-zoom-in rotate-[-2deg] hover:rotate-0 flex items-center justify-center">
                              <div className="relative overflow-hidden rounded bg-[var(--mm-bg-stone-50)]">
                                  <img 
                                    src={showcaseCases[activeShowcase].image} 
                                    alt="Original Problem" 
                                    className="w-auto h-auto max-w-full max-h-full object-contain block"
                                  />
                              </div>
                              <span className="absolute -top-3 -right-3 bg-[var(--mm-bg-red-500)] text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">原始题目</span>
                          </div>

                          {/* Interaction Hint Overlay */}
                          <div className="absolute top-6 right-6 z-10 bg-[var(--mm-bg-emerald-500)]/90 text-white text-xs font-bold px-4 py-2 rounded-full backdrop-blur-sm pointer-events-none shadow-lg animate-pulse flex items-center gap-2">
                              <MousePointerClick className="w-4 h-4" />
                              试着拖动图形
                          </div>

                      </div>
                  </div>

              </div>
          </div>
      </section>

      {/* Pricing Section (Integrated) */}
      <section className="py-24 relative z-10" id="pricing">
        <div className="max-w-4xl mx-auto px-6">

          <div className="text-center mb-14 space-y-5">
              <h2 className="text-4xl md:text-5xl font-black text-[var(--mm-text-stone-800)] tracking-tight">
                  完全免费，开箱即用
              </h2>
              <p className="text-[var(--mm-text-stone-500)] font-bold max-w-2xl mx-auto text-lg">
                  MathMover 是开源项目。接入你自己的模型 API Key，即可无限制使用全部功能。
              </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-[var(--mm-surface)] rounded-3xl border border-[var(--mm-border-stone-200)] p-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--mm-bg-emerald-50)] text-[var(--mm-text-emerald-600)] flex items-center justify-center mx-auto">
                      <Cpu className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-[var(--mm-text-stone-800)] text-lg">自带 Key</h3>
                  <p className="text-sm text-[var(--mm-text-stone-500)] font-medium leading-relaxed">支持 OpenAI 与 Anthropic 协议的任意兼容端点，在工作台设置中一分钟完成配置。</p>
              </div>
              <div className="bg-[var(--mm-surface)] rounded-3xl border border-[var(--mm-border-stone-200)] p-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--mm-bg-emerald-50)] text-[var(--mm-text-emerald-600)] flex items-center justify-center mx-auto">
                      <Zap className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-[var(--mm-text-stone-800)] text-lg">无限制生成</h3>
                  <p className="text-sm text-[var(--mm-text-stone-500)] font-medium leading-relaxed">没有积分与订阅，生成次数只取决于你自己的 API 额度。</p>
              </div>
              <div className="bg-[var(--mm-surface)] rounded-3xl border border-[var(--mm-border-stone-200)] p-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--mm-bg-emerald-50)] text-[var(--mm-text-emerald-600)] flex items-center justify-center mx-auto">
                      <Leaf className="w-6 h-6" />
                  </div>
                  <h3 className="font-bold text-[var(--mm-text-stone-800)] text-lg">本地与开源</h3>
                  <p className="text-sm text-[var(--mm-text-stone-500)] font-medium leading-relaxed">配置与历史都保存在你自己的设备上，代码完全开放。</p>
              </div>
          </div>

          <div className="mt-14 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/dashboard"
              className="w-full sm:w-auto px-7 py-3.5 rounded-full font-bold text-white bg-[var(--mm-bg-emerald-500)] hover:bg-[var(--mm-bg-emerald-600)] shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 group"
            >
              <span>免安装在线试用</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <a
              href="#releases"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto px-7 py-3.5 bg-[var(--mm-surface)] text-[var(--mm-text-stone-700)] border-2 border-[var(--mm-border-stone-200)] rounded-full font-bold text-base hover:border-[var(--mm-border-emerald-500)] hover:text-[var(--mm-text-emerald-600)] transition-all flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4 text-[var(--mm-text-emerald-600)]" />
              <span>下载桌面端 (Windows / macOS)</span>
            </a>
          </div>

        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-[var(--mm-border-stone-200)] bg-[var(--mm-surface)]">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
           <div className="flex items-center gap-2.5 opacity-60 hover:opacity-100 transition-opacity">
             <div className="w-8 h-8 bg-[var(--mm-bg-stone-800)] rounded-lg flex items-center justify-center text-white text-xs font-bold">M</div>
             <span className="font-bold text-[var(--mm-text-stone-700)] text-sm">MathMover Studio</span>
           </div>

           {/* Open Source Links */}
           <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-[var(--mm-text-stone-500)] font-medium">
             <a
               href="#github"
               target="_blank"
               rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 hover:text-[var(--mm-text-stone-900)] transition-colors"
             >
               <Github className="w-4 h-4" />
               <span>GitHub 仓库</span>
             </a>
             <a
               href="#releases"
               target="_blank"
               rel="noopener noreferrer"
               className="hover:text-[var(--mm-text-stone-900)] transition-colors"
             >
               版本发布 (Releases)
             </a>
             <a
               href="#issues"
               target="_blank"
               rel="noopener noreferrer"
               className="hover:text-[var(--mm-text-stone-900)] transition-colors"
             >
               提交反馈与 Issue
             </a>
           </div>

           <p className="text-[var(--mm-text-stone-400)] text-sm font-bold">&copy; 2026 by 北海鱼籽酱</p>
        </div>
      </footer>
    </div>
  );
}
