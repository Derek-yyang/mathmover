import Link from "next/link";
import { ArrowRight, Cuboid, ScanLine, Presentation, Play, Leaf, PenTool } from "lucide-react";

export default function LandingPage() {
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
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-[4px_4px_0px_0px_rgba(16,185,129,0.2)] transform -rotate-2 hover:rotate-0 transition-transform">
              M
            </div>
            <span className="font-bold text-xl tracking-tight text-stone-800">
              MathMover
            </span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm font-bold text-stone-500">
            <Link href="#features" className="hover:text-emerald-600 transition-colors">
              功能特性
            </Link>
            <Link href="#pricing" className="hover:text-emerald-600 transition-colors">
              价格方案
            </Link>
            <Link href="#community" className="hover:text-emerald-600 transition-colors">
              社区
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm font-bold text-stone-600 hover:text-stone-900 px-5 py-2.5 rounded-xl hover:bg-emerald-50/50 transition-colors"
            >
              登录
            </Link>
            <Link
              href="/dashboard"
              className="px-6 py-2.5 rounded-xl font-bold text-white bg-gradient-to-r from-emerald-500 to-green-600 shadow-[4px_4px_0px_0px_rgba(6,95,70,0.1)] hover:shadow-[2px_2px_0px_0px_rgba(6,95,70,0.1)] hover:translate-x-[2px] hover:translate-y-[2px] transition-all border-2 border-transparent active:scale-95"
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
              className="w-full sm:w-auto px-8 py-4 rounded-2xl font-bold text-white bg-gradient-to-r from-emerald-500 to-green-600 shadow-[6px_6px_0px_0px_rgba(16,185,129,0.25)] hover:shadow-[3px_3px_0px_0px_rgba(16,185,129,0.25)] hover:translate-x-[3px] hover:translate-y-[3px] transition-all flex items-center justify-center gap-2 border-2 border-transparent"
            >
              免费试用 <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="#demo"
              className="w-full sm:w-auto px-8 py-4 bg-white text-stone-700 border-2 border-stone-200 rounded-2xl font-bold text-lg hover:border-emerald-300 hover:text-emerald-700 transition-all shadow-[6px_6px_0px_0px_rgba(0,0,0,0.03)] hover:shadow-[3px_3px_0px_0px_rgba(0,0,0,0.03)] hover:translate-x-[3px] hover:translate-y-[3px] flex items-center justify-center gap-2"
            >
              <Play className="w-5 h-5 fill-current" /> 观看演示
            </Link>
          </div>

          {/* Visual Center - Paper Card */}
          <div className="relative max-w-4xl mx-auto">
            {/* Background rotation accent - Earthy Tones */}
            <div className="absolute inset-0 bg-[#E8F5E9] rounded-[2.5rem] transform rotate-2 scale-105 opacity-80"></div>
            <div className="absolute inset-0 bg-[#F1F8E9] rounded-[2.5rem] transform -rotate-1 scale-105 opacity-80"></div>
            
            <div className="relative bg-white rounded-[2rem] border-2 border-stone-100 shadow-xl overflow-hidden p-4 transform transition-transform hover:scale-[1.01] duration-500">
              <div className="bg-stone-50 rounded-[1.5rem] overflow-hidden aspect-video border-2 border-dashed border-stone-200 flex items-center justify-center relative group cursor-pointer">
                
                {/* Play Button - Sticker Style */}
                <div className="relative z-10">
                    <div className="w-20 h-20 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full flex items-center justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)] group-hover:scale-110 transition-transform duration-300 border-4 border-white">
                        <Play className="w-8 h-8 text-white fill-white ml-1" />
                    </div>
                </div>
                
                <div className="absolute top-8 left-8 bg-teal-50 text-teal-800 px-4 py-2 rounded-lg font-bold text-sm transform -rotate-6 shadow-sm border border-teal-100">
                    拍照即得 📸
                </div>
                <div className="absolute bottom-8 right-8 bg-lime-50 text-lime-800 px-4 py-2 rounded-lg font-bold text-sm transform rotate-3 shadow-sm border border-lime-100">
                    交互演示 🕹️
                </div>

                {/* Graph Paper Grid - Green Tint */}
                <div className="absolute inset-0 opacity-[0.08]"
                     style={{ backgroundImage: "linear-gradient(#10b981 1px, transparent 1px), linear-gradient(90deg, #10b981 1px, transparent 1px)", backgroundSize: "40px 40px" }}>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="py-32 relative z-10" id="features">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="group p-8 rounded-3xl bg-white border-2 border-stone-100 hover:border-emerald-200 hover:shadow-[8px_8px_0px_0px_rgba(16,185,129,0.1)] transition-all duration-300">
              <div className="w-14 h-14 bg-teal-50 rounded-2xl flex items-center justify-center mb-6 group-hover:rotate-6 transition-transform duration-300 border-2 border-teal-100">
                <ScanLine className="w-7 h-7 text-teal-600 stroke-2" />
              </div>
              <h3 className="text-xl font-bold text-stone-800 mb-3">
                智能视觉
              </h3>
              <p className="text-stone-500 leading-relaxed font-medium">
                先进的 AI 视觉识别您的手写草图和形状，将其转化为严谨的数学逻辑。
              </p>
            </div>

            {/* Feature 2 */}
            <div className="group p-8 rounded-3xl bg-white border-2 border-stone-100 hover:border-emerald-200 hover:shadow-[8px_8px_0px_0px_rgba(16,185,129,0.1)] transition-all duration-300">
              <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mb-6 group-hover:-rotate-6 transition-transform duration-300 border-2 border-emerald-100">
                <Cuboid className="w-7 h-7 text-emerald-600 stroke-2" />
              </div>
              <h3 className="text-xl font-bold text-stone-800 mb-3">
                3D 游乐场
              </h3>
              <p className="text-stone-500 leading-relaxed font-medium">
                瞬间切换维度。旋转立方体，切割圆锥，像玩游戏一样探索立体几何。
              </p>
            </div>

            {/* Feature 3 */}
            <div className="group p-8 rounded-3xl bg-white border-2 border-stone-100 hover:border-emerald-200 hover:shadow-[8px_8px_0px_0px_rgba(16,185,129,0.1)] transition-all duration-300">
              <div className="w-14 h-14 bg-lime-50 rounded-2xl flex items-center justify-center mb-6 group-hover:rotate-6 transition-transform duration-300 border-2 border-lime-100">
                <Presentation className="w-7 h-7 text-lime-700 stroke-2" />
              </div>
              <h3 className="text-xl font-bold text-stone-800 mb-3">
                课堂就绪
              </h3>
              <p className="text-stone-500 leading-relaxed font-medium">
                制作学生喜爱的引人入胜的课件。直接导出到 GeoGebra 或分享简单的网页链接。
              </p>
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
           <p className="text-stone-400 text-sm font-bold">&copy; 2024 MathMover Inc.</p>
        </div>
      </footer>
    </div>
  );
}
