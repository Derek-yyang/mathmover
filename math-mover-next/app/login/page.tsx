"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  Mail,
  Loader2,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle
} from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isResetMode, setIsResetMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const getSiteOrigin = () => {
    if (typeof window === "undefined") return "https://www.mathmover.top";
    const { hostname, origin } = window.location;
    if (["localhost", "127.0.0.1", "mathmover.top", "www.mathmover.top"].includes(hostname)) {
      return origin;
    }
    return "https://www.mathmover.top";
  };

  const normalizeAuthError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err || "");
    const lower = message.toLowerCase();

    if (lower.includes("already registered") || lower.includes("already been registered")) {
      return "这个邮箱已经注册过，请直接登录或使用“忘记密码”。";
    }
    if (lower.includes("invalid email") || lower.includes("email address")) {
      return "邮箱格式不正确，请检查后再试。";
    }
    if (lower.includes("password") && (lower.includes("6") || lower.includes("weak"))) {
      return "密码强度不足，请至少输入 6 位密码。";
    }
    if (lower.includes("signup") && lower.includes("disabled")) {
      return "当前暂时关闭新用户注册，请稍后再试。";
    }
    if (lower.includes("rate limit") || lower.includes("too many")) {
      return "请求太频繁，请稍等几分钟后再试。";
    }
    if (lower.includes("email rate limit")) {
      return "验证邮件发送太频繁，请稍等几分钟后再试。";
    }

    return message || "服务暂时不可用，请稍后再试";
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || !normalizedEmail.includes("@")) {
        throw new Error("请输入有效的邮箱地址");
      }

      const siteOrigin = getSiteOrigin();
      const redirectTo = `${siteOrigin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo,
      });

      if (error) throw error;
      setSuccessMsg("重置密码邮件已发送，请打开邮箱里的链接设置新密码。");
    } catch (err: any) {
      console.error("发送重置邮件出错:", err);
      setErrorMsg(normalizeAuthError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || !normalizedEmail.includes("@")) {
        throw new Error("请输入有效的邮箱地址");
      }
      if (password.length < 6) {
        throw new Error("密码至少需要 6 位");
      }

      if (isLoginMode) {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
        setSuccessMsg("登录成功！正在进入工作台...");
        setTimeout(() => router.push("/dashboard"), 500);
      } else {
        const { error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            emailRedirectTo: `${getSiteOrigin()}/login`,
          },
        });
        if (error) throw error;
        setSuccessMsg("注册成功！请查收验证邮件，验证后即可登录。若收件箱没有，请检查垃圾邮件。");
        setIsLoginMode(true);
      }
    } catch (err: any) {
      console.error("认证出错:", err);
      setErrorMsg(normalizeAuthError(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-4 selection:bg-emerald-100 selection:text-emerald-900 relative">

      <Link
        href="/"
        className="absolute top-8 left-8 flex items-center gap-2 px-4 py-2 rounded-full text-zinc-500 font-bold text-sm hover:bg-emerald-50 hover:text-emerald-600 transition-all duration-300 group z-50"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        返回首页
      </Link>

      <div className="mb-8 flex flex-col items-center gap-2 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-200 transform -rotate-3">
          <span className="font-black text-2xl">M</span>
        </div>
        <h1 className="text-2xl font-bold text-zinc-800 tracking-tight">MathMover</h1>
      </div>

      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden border border-zinc-100 animate-in zoom-in-95 duration-500 transition-all z-10">

        <div className="px-8 pt-8 pb-6 text-center">
          <h2 className="text-xl font-bold text-zinc-800">
            {isResetMode ? "找回密码" : isLoginMode ? "欢迎回来" : "创建新账号"}
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            {isResetMode ? "输入邮箱，我们会发送重置链接" : isLoginMode ? "请输入邮箱和密码登录" : "开启您的数学可视化之旅"}
          </p>
        </div>

        <div className="p-8 pt-6">

          {errorMsg && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-xs text-red-600 font-bold animate-in slide-in-from-top-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-2 text-xs text-emerald-600 font-bold animate-in slide-in-from-top-2">
               <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
               {successMsg}
            </div>
          )}

            <form onSubmit={isResetMode ? handlePasswordReset : handleAuth} className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-400 ml-1">邮箱地址</label>
                <div className="relative group">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300 group-focus-within:text-emerald-500 transition-colors">
                    <Mail className="w-5 h-5" />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full pl-10 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all"
                    required
                  />
                </div>
              </div>

              {!isResetMode && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-zinc-400 ml-1">密码</label>
                    {isLoginMode && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsResetMode(true);
                          setErrorMsg(null);
                          setSuccessMsg(null);
                          setPassword("");
                        }}
                        className="text-xs font-bold text-emerald-600 hover:underline focus:outline-none"
                      >
                        忘记密码？
                      </button>
                    )}
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isLoginMode ? "输入密码" : "设置密码（至少6位）"}
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all"
                    required
                    minLength={6}
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-6 bg-emerald-500 text-white py-3.5 rounded-full font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-600 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-70 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{isResetMode ? "发送中..." : isLoginMode ? "登录中..." : "注册中..."}</span>
                  </>
                ) : (
                  <>
                    <span>{isResetMode ? "发送重置邮件" : isLoginMode ? "立即登录" : "立即注册"}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

          <div className="mt-8 pt-6 border-t border-zinc-100 text-center space-y-4">
            <p className="text-xs text-zinc-400 font-medium animate-in fade-in duration-500">
              {isResetMode ? "想起密码了？" : isLoginMode ? "还没有账号？" : "已有账号？"}
              <button
                onClick={() => {
                    if (isResetMode) {
                      setIsResetMode(false);
                      setIsLoginMode(true);
                    } else {
                    setIsLoginMode(!isLoginMode);
                    }
                    setErrorMsg(null);
                    setSuccessMsg(null);
                    setPassword("");
                }}
                className="text-emerald-600 font-bold hover:underline ml-1 focus:outline-none"
              >
                {isResetMode ? "返回登录" : isLoginMode ? "免费注册新用户" : "直接登录"}
              </button>
            </p>
          </div>

        </div>
      </div>

      <div className="mt-8 text-xs text-zinc-400 font-medium text-center">
        © 2026 MathMover Studio. All rights reserved.
      </div>

    </div>
  );
}
