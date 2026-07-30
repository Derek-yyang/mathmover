"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowLeft, Cuboid, Play, Leaf, User as UserIcon, Check, Zap, Crown, Rocket, ScanEye, Box, MousePointerClick, Cpu, FileUp } from "lucide-react";
import { motion } from 'framer-motion';
import { supabase } from "@/lib/supabase";
import {
  BillingCycle,
  SubscriptionPlan,
  getSubscriptionPricing as getPricing,
  getSubscriptionPurchaseUrl,
} from "@/lib/billing";

import dynamic from 'next/dynamic';

const GeoGebraBoard = dynamic(() => import('@/components/GeoGebraBoard'), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center bg-stone-50 text-stone-400 font-bold">加载画板中...</div>
});

export default function LandingPage() {
  const [user, setUser] = useState<any>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

  // 购买跳转逻辑
  const handlePurchase = (plan: SubscriptionPlan, cycle: BillingCycle) => {
    const targetUrl = getSubscriptionPurchaseUrl(plan, cycle);
    if (targetUrl) {
        window.open(targetUrl, '_blank');
    } else {
        // 如果没有配置链接，则跳转到登录页/工作台
        window.location.href = '/dashboard?action=redeem';
    }
  };
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
SetAxesVisible(true, true)
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
SetAxesVisible(true, true)
SetGridVisible(true)
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

  // 用户状态检查
  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
      }
    };
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => subscription.unsubscribe();
  }, []);

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
    <div className="min-h-screen bg-[#FDFCF8] text-stone-800 font-sans selection:bg-emerald-100 selection:text-emerald-900 relative overflow-x-hidden">
      
      {/* Organic Ambience (Absolute) */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Natural Glows */}
        <div className="absolute top-[-10%] left-[-5%] w-[45%] h-[45%] bg-emerald-100/40 rounded-full blur-[120px] mix-blend-multiply animate-pulse-slow"></div>
        <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-lime-100/40 rounded-full blur-[100px] mix-blend-multiply animate-pulse-slow delay-1000"></div>
        
        {/* Floating Shapes/Doodles - Green Theme */}
        <div className="absolute top-32 left-12 opacity-40 hidden lg:block animate-bounce-slow">
            <div className="w-12 h-12 border-4 border-dashed border-emerald-300 rounded-full rotate-12"></div>
        </div>
        <div className="absolute bottom-40 right-24 opacity-40 hidden lg:block animate-bounce-slow delay-500">
            <div className="w-16 h-16 border-4 border-dashed border-teal-300 rotate-45 transform skew-x-12"></div>
        </div>
        {/* Hand-drawn style arrow using CSS borders */}
        <div className="absolute top-44 right-[18%] opacity-30 hidden xl:block rotate-6">
            <div className="w-20 h-20 border-t-4 border-r-4 border-emerald-400 rounded-tr-[3rem]"></div>
        </div>
      </div>

      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 transition-all duration-300 bg-[#FDFCF8]/80 backdrop-blur-md border-b border-stone-200/50">
        <div className="w-full max-w-[1440px] mx-auto px-10 h-20 flex items-center justify-between">
          {/* Logo Section */}
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-[4px_4px_0px_0px_rgba(16,185,129,0.2)] transform -rotate-2 hover:rotate-0 transition-transform">
              M
            </div>
            <span className="font-bold text-xl tracking-tight text-stone-800">
              MathMover
            </span>
          </div>

          {/* Center Navigation - Premium Look */}
          <div className="hidden md:flex items-center gap-10 absolute left-1/2 transform -translate-x-1/2">
            <Link href="#features" scroll={true} className="text-sm font-medium text-zinc-600 hover:text-emerald-600 transition-colors relative group">
              功能特性
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-emerald-600 transition-all duration-300 group-hover:w-full rounded-full opacity-80"></span>
            </Link>
            <Link href="#showcase" scroll={true} className="text-sm font-medium text-zinc-600 hover:text-emerald-600 transition-colors relative group">
              案例展示
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-emerald-600 transition-all duration-300 group-hover:w-full rounded-full opacity-80"></span>
            </Link>
            <Link href="#pricing" scroll={true} className="text-sm font-medium text-zinc-600 hover:text-emerald-600 transition-colors relative group">
              价格方案
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-emerald-600 transition-all duration-300 group-hover:w-full rounded-full opacity-80"></span>
            </Link>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-4">
            {user ? (
              // 已登录状态：显示头像 and 用户名
              <Link 
                  href="/dashboard/profile"
                  className="flex items-center gap-3 px-2 py-1 select-none cursor-pointer hover:bg-zinc-100/50 hover:opacity-80 rounded-lg transition-all"
              >
                  <div className="w-9 h-9 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0 shadow-sm">
                      <UserIcon className="w-5 h-5 stroke-[2.5]" />
                  </div>
                  <span className="text-sm font-bold text-zinc-600 truncate max-w-[120px] hidden sm:block">
                      {user.email || '用户'}
                  </span>
              </Link>
            ) : (
              // 未登录状态：显示登录链接
              <Link
                href="/login"
                className="text-sm font-bold text-stone-600 hover:text-stone-900 px-5 py-2.5 rounded-full hover:bg-emerald-50 transition-colors"
              >
                登录
              </Link>
            )}
            
            <Link
              href="/dashboard"
              className="px-6 py-2.5 rounded-full font-bold text-white bg-emerald-500 hover:bg-emerald-600 shadow-sm hover:shadow-md hover:-translate-y-[1px] transition-all active:scale-95"
            >
              开始创作
            </Link>
          </div>
        </div>
      </nav>
 
      {/* Hero Section */}
      <section className="relative pt-44 pb-32 z-10">
        <div className="max-w-5xl mx-auto px-6 text-center">
          
          {/* Organic Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm font-bold mb-8 animate-fade-in-up transform -rotate-1 hover:rotate-0 transition-transform cursor-default shadow-sm">
            <Leaf className="w-3.5 h-3.5 fill-emerald-100" />
            <span>播种逻辑思维的种子</span>
          </div>
 
          {/* Headline */}
          <h1 className="text-6xl sm:text-7xl font-black tracking-tight text-stone-800 mb-8 leading-[1.1] text-center w-full pl-2">
            让数学可视化，<br className="hidden sm:block" />
            <span className="relative inline-block text-emerald-600">
              仅需数秒
              {/* Underline scribble - Green */}
              <svg className="absolute w-full h-3 -bottom-2 left-0 text-emerald-300 fill-transparent stroke-current stroke-[4]" viewBox="0 0 100 10" preserveAspectRatio="none">
                 <path d="M0 5 Q 50 12 100 5" />
              </svg>
            </span>
          </h1>
 
          <p className="text-xl text-stone-500 mb-12 max-w-2xl mx-auto leading-relaxed font-medium">
            一个有生命力的创作空间，让抽象问题绽放为交互式几何。
            上传一张快照，让我们的 AI 将其培育为动态的 GeoGebra 画布。
          </p>
 
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-5 mb-24">
            <Link
              href="/dashboard"
              className="w-full sm:w-auto px-8 py-4 rounded-full font-bold text-white bg-emerald-500 hover:bg-emerald-600 shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              免费试用 <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="#demo"
              className="w-full sm:w-auto px-8 py-4 bg-white text-stone-700 border-2 border-stone-200 rounded-full font-bold text-lg hover:border-emerald-500 hover:text-emerald-600 transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5 fill-current" /> 观看演示
            </Link>
          </div>

          {/* Visual Center - Paper Card */}
          <div className="relative max-w-4xl mx-auto">
            {/* Background rotation accent - Earthy Tones */}
            <div className="absolute inset-0 bg-[#E8F5E9] rounded-[2.5rem] transform rotate-2 scale-105 opacity-80"></div>
            <div className="absolute inset-0 bg-[#F1F8E9] rounded-[2.5rem] transform -rotate-1 scale-105 opacity-80"></div>
            
            <div id="demo" className="relative bg-white rounded-[2rem] border-2 border-stone-100 shadow-xl overflow-hidden p-4 transform transition-transform hover:scale-[1.01] duration-500">
              <div className="bg-black rounded-[1.5rem] overflow-hidden aspect-video relative shadow-inner border border-stone-200">
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
              <h2 className="text-4xl md:text-5xl font-black text-stone-800 tracking-tight">
                  不仅是工具，<br/>更是思维的延伸
              </h2>
              <p className="text-stone-500 font-bold text-lg max-w-2xl mx-auto">
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
                className="md:col-span-4 md:row-span-1 bg-white rounded-[2rem] p-8 md:p-10 border border-stone-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group flex flex-col justify-between"
            >
                <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50 rounded-full blur-[80px] -mr-20 -mt-20 group-hover:bg-emerald-100 transition-colors"></div>
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: "radial-gradient(#10b981 1px, transparent 1px)", backgroundSize: "24px 24px" }}></div>

                <div className="relative z-10">
                    <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mb-6 border border-emerald-100 group-hover:rotate-6 transition-transform duration-300">
                        <ScanEye className="w-7 h-7 text-emerald-600" />
                    </div>
                    <h3 className="text-2xl font-black text-stone-800 mb-3">AI 视觉解析：从快照到逻辑</h3>
                    <p className="text-stone-500 font-medium leading-relaxed max-w-lg">
                        强大的 AI 视觉引擎，不仅能看懂题目，更能读懂隐含的几何约束。无论是手写草稿还是书本截图，瞬间将其转化为可运行的严谨代码。
                    </p>
                </div>
                <div className="mt-8 flex gap-2">
                   <div className="px-3 py-1 bg-stone-50 rounded-lg text-xs font-bold text-stone-400 border border-stone-100">OCR 识别</div>
                   <div className="px-3 py-1 bg-stone-50 rounded-lg text-xs font-bold text-stone-400 border border-stone-100">语义理解</div>
                   <div className="px-3 py-1 bg-stone-50 rounded-lg text-xs font-bold text-stone-400 border border-stone-100">代码生成</div>
                </div>
            </motion.div>

            {/* Feature B: 2D & 3D (Medium Card) - 2 cols, 1 row */}
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.1 }}
                className="md:col-span-2 md:row-span-1 bg-white rounded-[2rem] p-8 border border-stone-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group flex flex-col"
            >
                <div className="absolute top-0 right-0 w-32 h-32 bg-teal-50 rounded-full blur-[60px] -mr-10 -mt-10 group-hover:bg-teal-100 transition-colors"></div>
                
                <div className="relative z-10">
                    <div className="w-12 h-12 bg-teal-50 rounded-2xl flex items-center justify-center mb-6 border border-teal-100 group-hover:-rotate-6 transition-transform duration-300">
                        <Box className="w-6 h-6 text-teal-600" />
                    </div>
                    <h3 className="text-xl font-black text-stone-800 mb-3">全维度引擎</h3>
                    <p className="text-stone-500 font-medium text-sm leading-relaxed">
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
                className="md:col-span-2 md:row-span-1 bg-white rounded-[2rem] p-8 border border-stone-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group flex flex-col"
            >
                 <div className="absolute bottom-0 left-0 w-32 h-32 bg-lime-50 rounded-full blur-[60px] -ml-10 -mb-10 group-hover:bg-lime-100 transition-colors"></div>

                <div className="relative z-10">
                    <div className="w-12 h-12 bg-lime-50 rounded-2xl flex items-center justify-center mb-6 border border-lime-100 group-hover:scale-110 transition-transform duration-300">
                        <MousePointerClick className="w-6 h-6 text-lime-600" />
                    </div>
                    <h3 className="text-xl font-black text-stone-800 mb-3">交互式课件</h3>
                    <p className="text-stone-500 font-medium text-sm leading-relaxed">
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
                className="md:col-span-2 md:row-span-1 bg-white rounded-[2rem] p-8 border border-stone-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group flex flex-col"
            >
                <div className="absolute top-0 right-0 w-24 h-24 bg-orange-50 rounded-full blur-[50px] -mr-8 -mt-8 group-hover:bg-orange-100 transition-colors"></div>

                <div className="relative z-10">
                    <div className="w-12 h-12 bg-orange-50 rounded-2xl flex items-center justify-center mb-6 border border-orange-100 group-hover:rotate-12 transition-transform duration-300">
                        <Cpu className="w-6 h-6 text-orange-600" />
                    </div>
                    <h3 className="text-xl font-black text-stone-800 mb-3">BYOK 极客模式</h3>
                    <p className="text-stone-500 font-medium text-sm leading-relaxed">
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
                className="md:col-span-2 md:row-span-1 bg-white rounded-[2rem] p-8 border border-stone-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative overflow-hidden group flex flex-col"
            >
                <div className="absolute bottom-0 right-0 w-24 h-24 bg-blue-50 rounded-full blur-[50px] -mr-8 -mb-8 group-hover:bg-blue-100 transition-colors"></div>

                <div className="relative z-10">
                    <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-6 border border-blue-100 group-hover:-translate-y-1 transition-transform duration-300">
                        <FileUp className="w-6 h-6 text-blue-600" />
                    </div>
                    <h3 className="text-xl font-black text-stone-800 mb-3">一键全平台导出</h3>
                    <p className="text-stone-500 font-medium text-sm leading-relaxed">
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
                  <h2 className="text-4xl md:text-5xl font-black text-stone-800 tracking-tight">
                      生成案例展示
                  </h2>
                  <p className="text-stone-500 font-bold text-lg max-w-2xl mx-auto">
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
                                    ? "bg-white border-emerald-500 shadow-lg scale-[1.02]" 
                                    : "bg-white/50 border-stone-100 hover:border-emerald-200 hover:bg-white"
                              }`}
                          >
                              <h3 className={`font-black text-lg mb-2 ${activeShowcase === index ? "text-emerald-700" : "text-stone-600"}`}>
                                  {item.title}
                              </h3>
                              <p className="text-sm text-stone-400 font-medium leading-relaxed">
                                  {item.desc}
                              </p>
                          </div>
                      ))}
                  </div>

                  {/* Right Stage (Main GeoGebra Area) */}
                  <div className="w-full lg:w-2/3 bg-stone-800 rounded-[2rem] p-3 shadow-2xl flex relative overflow-hidden ring-8 ring-stone-900/5">
                      {/* Tablet Frame */}
                      <div className="w-full h-full bg-stone-100 rounded-[1.5rem] overflow-hidden relative group">
                          
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
                          <div className="absolute bottom-6 left-6 z-10 max-w-[240px] max-h-[180px] bg-white p-2 rounded-lg shadow-2xl border-4 border-white transform transition-transform duration-300 hover:scale-[2] hover:z-50 origin-bottom-left cursor-zoom-in rotate-[-2deg] hover:rotate-0 flex items-center justify-center">
                              <div className="relative overflow-hidden rounded bg-stone-50">
                                  <img 
                                    src={showcaseCases[activeShowcase].image} 
                                    alt="Original Problem" 
                                    className="w-auto h-auto max-w-full max-h-full object-contain block"
                                  />
                              </div>
                              <span className="absolute -top-3 -right-3 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">原始题目</span>
                          </div>

                          {/* Interaction Hint Overlay */}
                          <div className="absolute top-6 right-6 z-10 bg-emerald-500/90 text-white text-xs font-bold px-4 py-2 rounded-full backdrop-blur-sm pointer-events-none shadow-lg animate-pulse flex items-center gap-2">
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
        <div className="max-w-6xl mx-auto px-6">
          
          <div className="text-center mb-16 space-y-6">
              <h2 className="text-4xl md:text-5xl font-black text-stone-800 tracking-tight">
                  选择适合您的创作计划
              </h2>
              <p className="text-stone-500 font-bold max-w-2xl mx-auto text-lg">
                  无论您是初学者还是专业极客，MathMover 都能为您提供强大的数学可视化支持。
              </p>

              {/* Billing Toggle - Pill Style */}
              <div className="flex items-center justify-center gap-1 mt-8 bg-stone-100 p-1 rounded-full border border-stone-200 w-fit mx-auto relative">
                  {[
                      { id: 'monthly', label: '月付' },
                      { id: 'quarterly', label: '季付', discount: '-10%', color: 'bg-orange-500' },
                      { id: 'annually', label: '年付', discount: '-20%', color: 'bg-red-500' },
                  ].map((item) => (
                      <button
                          key={item.id}
                          onClick={() => setBillingCycle(item.id as any)}
                          className={`px-6 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-2 relative z-10 ${
                              billingCycle === item.id 
                              ? 'bg-white text-emerald-600 shadow-sm' 
                              : 'text-stone-400 hover:text-stone-600'
                          }`}
                      >
                          {item.label}
                          {item.discount && (
                              <span className={`${item.color} text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none`}>
                                  {item.discount}
                              </span>
                          )}
                      </button>
                  ))}
              </div>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto items-start">
              
              {/* Card A: Free Plan (Experience) */}
              <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.1 }}
                  className="bg-white rounded-[2rem] p-8 border border-stone-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col h-full relative overflow-hidden group"
              >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-stone-50 rounded-full blur-[60px] -mr-16 -mt-16 group-hover:bg-stone-100 transition-colors"></div>
                  
                  <div className="mb-6 relative">
                      <div className="w-12 h-12 bg-stone-100 rounded-2xl flex items-center justify-center text-stone-500 mb-4 group-hover:rotate-12 transition-transform">
                          <Rocket className="w-6 h-6" />
                      </div>
                      <h3 className="text-xl font-black text-stone-800">体验版</h3>
                      <p className="text-stone-400 text-sm font-bold mt-1">零成本开启数学可视化之旅</p>
                  </div>

                  <div className="flex items-baseline gap-1 mb-8 relative">
                      <span className="text-4xl font-black text-stone-800">¥0</span>
                      <span className="text-stone-400 font-bold">/ 永久</span>
                  </div>
                  
                  <div className="space-y-4 mb-8 flex-1 relative">
                      <div className="flex items-start gap-3">
                          <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                          <span className="text-sm font-bold text-stone-600">每日赠送 <span className="text-emerald-600">3</span> 积分</span>
                      </div>
                      <div className="flex items-start gap-3">
                          <Check className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                          <span className="text-sm font-bold text-stone-600">每日零点自动重置</span>
                      </div>
                      <div className="flex items-start gap-3">
                          <Check className="w-5 h-5 text-stone-300 flex-shrink-0 mt-0.5" />
                          <span className="text-sm font-bold text-stone-400 line-through decoration-stone-300">不支持 BYOK 极客模式</span>
                      </div>
                  </div>

                  <button className="w-full py-3.5 bg-stone-100 text-stone-400 font-bold rounded-full cursor-not-allowed relative">
                      当前版本
                  </button>
              </motion.div>

              {/* Card B: Basic Plan (New) */}
              <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.2 }}
                  className="bg-white rounded-[2rem] p-8 border border-stone-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col h-full relative overflow-hidden group"
              >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-teal-50 rounded-full blur-[60px] -mr-16 -mt-16 group-hover:bg-teal-100 transition-colors"></div>

                  <div className="mb-6 relative">
                      <div className="w-12 h-12 bg-teal-50 text-teal-600 rounded-2xl flex items-center justify-center mb-4 group-hover:rotate-12 transition-transform border border-teal-100">
                          <Cuboid className="w-6 h-6" />
                      </div>
                      <h3 className="text-xl font-black text-stone-800">基础会员 Basic</h3>
                      <p className="text-stone-400 text-sm font-bold mt-1">适合自备api Key 的用户</p>
                  </div>

                  <div className="flex items-baseline gap-1 mb-1 relative">
                      <span className="text-4xl font-black text-stone-800">¥{getPricing('basic', billingCycle).total}</span>
                      <span className="text-stone-400 font-bold"> / {getPricing('basic', billingCycle).unit}</span>
                  </div>
                  <div className="text-[10px] text-stone-400 font-bold mb-8 relative">
                      {billingCycle !== 'monthly' && `折合 ¥${getPricing('basic', billingCycle).avg} / 月`}
                  </div>
                  
                  <div className="space-y-4 mb-8 flex-1 relative">
                      <div className="flex items-start gap-3">
                          <Check className="w-5 h-5 text-teal-500 flex-shrink-0 mt-0.5" />
                          <div className="flex flex-col">
                              <span className="text-sm font-bold text-stone-600">解锁 BYOK 模式</span>
                              <span className="text-[10px] text-teal-600 font-bold">支持 Qwen3.5 plus, Doubao-Seed 2.0 等</span>
                          </div>
                      </div>
                      <div className="flex items-start gap-3">
                          <Check className="w-5 h-5 text-stone-300 flex-shrink-0 mt-0.5" />
                          <span className="text-sm font-bold text-stone-400">不赠送平台积分</span>
                      </div>
                      <div className="flex items-start gap-3">
                          <Check className="w-5 h-5 text-teal-500 flex-shrink-0 mt-0.5" />
                          <span className="text-sm font-bold text-stone-600">标准生成队列</span>
                      </div>
                  </div>

                  <button 
                      onClick={() => handlePurchase('basic', billingCycle)}
                      className="w-full py-3.5 bg-white border-2 border-stone-200 text-stone-600 font-bold rounded-full hover:border-emerald-400 hover:text-emerald-600 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] transition-all text-center block"
                  >
                      立即订阅
                  </button>
              </motion.div>

              {/* Card C: Pro Subscription (Featured) */}
              <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 }}
                  className="bg-emerald-500 rounded-[2rem] p-8 shadow-sm hover:shadow-xl hover:-translate-y-2 transition-all duration-300 flex flex-col h-full relative overflow-hidden z-10 border border-emerald-400"
              >
                  {/* Glowing Effect */}
                  <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-400 rounded-full blur-[100px] opacity-30 -mr-20 -mt-20 pointer-events-none"></div>
                  
                  <div className="absolute top-6 right-6">
                      <span className="bg-white/20 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-sm backdrop-blur-sm">
                          <Crown className="w-3 h-3 fill-current" /> 最推荐
                      </span>
                  </div>

                  <div className="mb-6 relative">
                      <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-white mb-4 backdrop-blur-sm">
                          <Zap className="w-6 h-6 fill-current" />
                      </div>
                      <h3 className="text-xl font-black text-white">高级会员 Pro</h3>
                      <p className="text-emerald-50 text-sm font-bold mt-1">全能旗舰，算力与自由兼得</p>
                  </div>

                  <div className="flex items-baseline gap-1 mb-1 relative">
                      <span className="text-5xl font-black text-white tracking-tight">
                          ¥{getPricing('pro', billingCycle).total}
                      </span>
                      <span className="text-emerald-100 font-bold">
                          / {getPricing('pro', billingCycle).unit}
                      </span>
                  </div>
                  <div className="text-[10px] text-emerald-100/60 font-bold mb-6 relative">
                      {billingCycle !== 'monthly' && `折合 ¥${getPricing('pro', billingCycle).avg} / 月`}
                  </div>
                  
                  <div className="space-y-5 mb-10 flex-1 relative">
                      <div className="flex items-start gap-3">
                          <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <Check className="w-3 h-3 text-white stroke-[3]" />
                          </div>
                          <span className="text-sm font-bold text-white">
                              每月赠送 <span className="text-white text-lg">60</span> 积分
                          </span>
                      </div>
                      <div className="flex items-start gap-3">
                          <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <Check className="w-3 h-3 text-white stroke-[3]" />
                          </div>
                          <div className="flex flex-col">
                              <span className="text-sm font-bold text-white">解锁 BYOK 极客模式</span>
                              <span className="text-[10px] text-emerald-50 font-bold">支持自定义 API Key</span>
                          </div>
                      </div>
                      <div className="flex items-start gap-3">
                          <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <Check className="w-3 h-3 text-white stroke-[3]" />
                          </div>
                          <span className="text-sm font-bold text-white">标准生成队列</span>
                      </div>
                  </div>

                  <button 
                      onClick={() => handlePurchase('pro', billingCycle)}
                      className="w-full py-4 bg-white text-emerald-600 font-black rounded-full shadow-md hover:shadow-lg hover:bg-emerald-50 hover:scale-[1.01] active:scale-[0.98] transition-all text-center relative overflow-hidden group/btn"
                  >
                      <span className="relative z-10 flex items-center justify-center gap-2">
                          立即订阅 <ArrowLeft className="w-4 h-4 rotate-180" />
                      </span>
                  </button>
              </motion.div>

          </div>
          
          <div className="mt-16 text-center max-w-xl mx-auto bg-stone-50 rounded-2xl p-6 border border-stone-100">
              <div className="flex items-start gap-3 text-left">
                  <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center flex-shrink-0 text-stone-500 font-bold">
                      i
                  </div>
                  <div>
                      <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-stone-800 text-sm">关于 BYOK (Bring Your Own Key) 模式</h4>
                          <a 
                              href="https://dcnql2nounts.feishu.cn/docx/OEbXdheS3oxfqyxNy7Zc3ksUnJb" 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-0.5 bg-emerald-50 px-2 py-0.5 rounded-full transition-colors"
                          >
                              如何使用 BYOK 模式 <ArrowRight className="w-3 h-3" />
                          </a>
                      </div>
                      <p className="text-xs text-stone-500 leading-relaxed font-medium">
                          该模式仅对<span className="text-emerald-600 font-bold"> 基础会员及以上等级 </span>开放。开启后，您可以使用自己的 Qwen/Doubao/Gemini 等模型 API Key 进行生成，不再消耗平台积分，且可以使用更强大的模型 (如 GPT-5, Gemini3.1-pro) 以获得最佳效果。
                      </p>
                  </div>
              </div>
          </div>

        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-stone-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
           <div className="flex items-center gap-2.5 opacity-60 hover:opacity-100 transition-opacity">
             <div className="w-8 h-8 bg-stone-800 rounded-lg flex items-center justify-center text-white text-xs font-bold">M</div>
             <span className="font-bold text-stone-700 text-sm">MathMover Studio</span>
           </div>
           <p className="text-stone-400 text-sm font-bold">&copy; 2026 by 北海鱼籽酱</p>
        </div>
      </footer>
    </div>
  );
}
