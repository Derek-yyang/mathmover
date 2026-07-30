"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  LockKeyhole,
} from "lucide-react";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-50 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-emerald-500" /></div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      setHasRecoverySession(Boolean(data.session));
      setIsCheckingSession(false);
    };

    checkSession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        setHasRecoverySession(Boolean(session));
        setIsCheckingSession(false);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      if (password.length < 6) {
        throw new Error("新密码至少需要 6 位");
      }
      if (password !== confirmPassword) {
        throw new Error("两次输入的密码不一致");
      }

      setIsLoading(true);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      setSuccessMsg("密码已更新，正在进入工作台...");
      setTimeout(() => router.push("/dashboard"), 800);
    } catch (err: any) {
      console.error("更新密码出错:", err);
      setErrorMsg(err.message || "密码更新失败，请重新打开邮件链接再试");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-4 selection:bg-emerald-100 selection:text-emerald-900 relative">
      <Link
        href="/login"
        className="absolute top-8 left-8 flex items-center gap-2 px-4 py-2 rounded-full text-zinc-500 font-bold text-sm hover:bg-emerald-50 hover:text-emerald-600 transition-all duration-300 group z-50"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        返回登录
      </Link>

      <div className="mb-8 flex flex-col items-center gap-2 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-200 transform -rotate-3">
          <span className="font-black text-2xl">M</span>
        </div>
        <h1 className="text-2xl font-bold text-zinc-800 tracking-tight">MathMover</h1>
      </div>

      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden border border-zinc-100 animate-in zoom-in-95 duration-500 transition-all z-10">
        <div className="px-8 pt-8 pb-6 text-center">
          <h2 className="text-xl font-bold text-zinc-800">设置新密码</h2>
          <p className="text-sm text-zinc-400 mt-1">请为账号设置一个新的登录密码</p>
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

          {isCheckingSession ? (
            <div className="py-10 flex items-center justify-center text-zinc-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : !hasRecoverySession ? (
            <div className="space-y-5 text-center">
              <div className="p-4 rounded-2xl bg-zinc-50 border border-zinc-100 text-sm font-medium text-zinc-500">
                重置链接已失效或未正确打开，请回到登录页重新发送密码重置邮件。
              </div>
              <Link
                href="/login"
                className="w-full bg-emerald-500 text-white py-3.5 rounded-full font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-600 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2"
              >
                返回登录
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <form onSubmit={handleUpdatePassword} className="space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-400 ml-1">新密码</label>
                <div className="relative group">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300 group-focus-within:text-emerald-500 transition-colors">
                    <LockKeyhole className="w-5 h-5" />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="输入新密码（至少6位）"
                    className="w-full pl-10 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all"
                    required
                    minLength={6}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-400 ml-1">确认新密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入新密码"
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all"
                  required
                  minLength={6}
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-6 bg-emerald-500 text-white py-3.5 rounded-full font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-600 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-70 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>更新中...</span>
                  </>
                ) : (
                  <>
                    <span>更新密码</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
