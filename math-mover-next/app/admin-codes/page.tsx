"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";

type Kind = "credits" | "membership";
type Status = "unused" | "used" | "all";

type CreditRow = {
  id: string;
  code: string;
  points: number;
  is_used: boolean;
  used_by: string | null;
  used_at: string | null;
};

type MembershipRow = {
  id: string;
  code: string;
  duration_days: number;
  subscription_tier: "basic" | "pro";
  is_used: boolean;
  used_by: string | null;
  used_at: string | null;
  created_at?: string | null;
};

type CodeRow = CreditRow | MembershipRow;

type Stats = {
  credits: { unused: number; used: number; total: number };
  membership: { unused: number; used: number; total: number };
};

const emptyStats: Stats = {
  credits: { unused: 0, used: 0, total: 0 },
  membership: { unused: 0, used: 0, total: 0 },
};

function isMembershipRow(row: CodeRow): row is MembershipRow {
  return "subscription_tier" in row;
}

function rowValue(row: CodeRow) {
  if (isMembershipRow(row)) {
    return `${row.subscription_tier.toUpperCase()} ${row.duration_days} 天`;
  }

  return `${row.points} 永久积分`;
}

function toCsv(rows: CodeRow[]) {
  const header = ["code", "type", "value", "status", "used_by", "used_at"];
  const lines = rows.map((row) =>
    [
      row.code,
      isMembershipRow(row) ? "membership" : "credits",
      rowValue(row),
      row.is_used ? "used" : "unused",
      row.used_by ?? "",
      row.used_at ?? "",
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(",")
  );

  return [header.join(","), ...lines].join("\n");
}

export default function AdminCodesPage() {
  const [kind, setKind] = useState<Kind>("credits");
  const [status, setStatus] = useState<Status>("unused");
  const [rows, setRows] = useState<CodeRow[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [generatedCodes, setGeneratedCodes] = useState<CodeRow[]>([]);
  const [generatedCopied, setGeneratedCopied] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "done">("idle");

  const [creditCount, setCreditCount] = useState(10);
  const [creditPoints, setCreditPoints] = useState(300);
  const [membershipCount, setMembershipCount] = useState(10);
  const [membershipTier, setMembershipTier] = useState<"basic" | "pro">("pro");
  const [membershipDays, setMembershipDays] = useState(30);

  const selectedUnusedCount = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.id) && !row.is_used).length,
    [rows, selectedIds]
  );

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIds.includes(row.id)),
    [rows, selectedIds]
  );

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/admin-codes?kind=${kind}&status=${status}&limit=120`, {
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "读取兑换码失败。");
      }

      setRows(data.rows ?? []);
      setStats(data.stats ?? emptyStats);
      setSelectedIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取兑换码失败。");
    } finally {
      setLoading(false);
    }
  }, [kind, status]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const generateCodes = async (nextKind: Kind) => {
    setGenerating(true);
    setError("");
    setMessage("");
    setGeneratedCodes([]);
    setGeneratedCopied(false);

    const body =
      nextKind === "credits"
        ? { kind: "credits", count: creditCount, points: creditPoints }
        : {
            kind: "membership",
            count: membershipCount,
            tier: membershipTier,
            durationDays: membershipDays,
          };

    try {
      const response = await fetch("/api/admin-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "生成兑换码失败。");
      }

      setKind(nextKind);
      setStatus("unused");
      setRows(data.rows ?? []);
      setSelectedIds((data.rows ?? []).map((row: CodeRow) => row.id));
      setMessage(data.message ?? "生成成功。");
      setGeneratedCodes(data.rows ?? []);
      await loadRows();
      setSelectedIds((data.rows ?? []).map((row: CodeRow) => row.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成兑换码失败。");
    } finally {
      setGenerating(false);
    }
  };

  const copyGeneratedCodes = async () => {
    try {
      await navigator.clipboard.writeText(
        generatedCodes.map((row) => row.code).join("\n")
      );
      setGeneratedCopied(true);
      setTimeout(() => setGeneratedCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择复制。");
    }
  };

  const copyCodes = async (targetRows = selectedRows.length ? selectedRows : rows) => {
    if (!targetRows.length) return;

    await navigator.clipboard.writeText(targetRows.map((row) => row.code).join("\n"));
    setCopyState("done");
    setTimeout(() => setCopyState("idle"), 1500);
  };

  const exportCsv = (targetRows = selectedRows.length ? selectedRows : rows) => {
    if (!targetRows.length) return;

    const blob = new Blob([toCsv(targetRows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mathmover-${kind}-codes-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deleteSelected = async () => {
    if (!selectedUnusedCount) return;

    const confirmed = window.confirm(`确定删除 ${selectedUnusedCount} 个未使用兑换码吗？已使用的码不会被删除。`);
    if (!confirmed) return;

    setDeleting(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/admin-codes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ids: selectedIds }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "删除兑换码失败。");
      }

      setMessage(data.message ?? "删除成功。");
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除兑换码失败。");
    } finally {
      setDeleting(false);
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const toggleAllVisible = () => {
    const visibleIds = rows.filter((row) => !row.is_used).map((row) => row.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : visibleIds);
  };

  return (
    <main className="min-h-screen bg-[#FDFCF8] text-stone-900">
      <section className="border-b border-stone-200 bg-[#F5F5F0]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-lg font-black text-white shadow-sm">
              M
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-stone-900">兑换码管理</h1>
              <p className="text-xs font-semibold text-stone-500">本地管理员工具，仅允许 localhost 访问</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 sm:flex">
            <ShieldCheck className="h-4 w-4" />
            Service role 仅在服务端使用
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-5">
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-600" />
              <h2 className="text-sm font-black text-stone-900">生成积分码</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-bold text-stone-500">数量</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={creditCount}
                  onChange={(event) => setCreditCount(Number(event.target.value))}
                  className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-bold outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold text-stone-500">永久积分</span>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={creditPoints}
                  onChange={(event) => setCreditPoints(Number(event.target.value))}
                  className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-bold outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>
            </div>
            <button
              onClick={() => generateCodes("credits")}
              disabled={generating}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-emerald-500 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              生成积分兑换码
            </button>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-emerald-600" />
              <h2 className="text-sm font-black text-stone-900">生成会员码</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs font-bold text-stone-500">数量</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={membershipCount}
                  onChange={(event) => setMembershipCount(Number(event.target.value))}
                  className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-bold outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold text-stone-500">天数</span>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={membershipDays}
                  onChange={(event) => setMembershipDays(Number(event.target.value))}
                  className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-bold outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                />
              </label>
            </div>
            <div className="mt-3 grid grid-cols-2 rounded-xl bg-stone-100 p-1">
              {(["basic", "pro"] as const).map((tier) => (
                <button
                  key={tier}
                  onClick={() => setMembershipTier(tier)}
                  className={`rounded-lg px-3 py-2 text-xs font-black transition ${
                    membershipTier === tier
                      ? "bg-white text-emerald-700 shadow-sm"
                      : "text-stone-500 hover:text-stone-800"
                  }`}
                >
                  {tier.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              onClick={() => generateCodes("membership")}
              disabled={generating}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-stone-900 px-5 py-3 text-sm font-black text-white transition hover:bg-stone-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              生成会员兑换码
            </button>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold leading-5 text-amber-800">
            <div className="mb-2 flex items-center gap-2 font-black">
              <AlertTriangle className="h-4 w-4" />
              操作边界
            </div>
            删除功能只会删除未使用兑换码。已兑换的记录保留，方便以后审计。
          </div>
        </aside>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat label="积分码未使用" value={stats.credits.unused} />
            <Stat label="积分码已使用" value={stats.credits.used} />
            <Stat label="会员码未使用" value={stats.membership.unused} />
            <Stat label="会员码已使用" value={stats.membership.used} />
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-stone-100 p-5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h2 className="text-base font-black text-stone-900">兑换码列表</h2>
                <p className="mt-1 text-xs font-semibold text-stone-500">
                  当前显示 {rows.length} 条，已选择 {selectedIds.length} 条
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented<Kind>
                  value={kind}
                  onChange={setKind}
                  options={[
                    { label: "积分码", value: "credits" },
                    { label: "会员码", value: "membership" },
                  ]}
                />
                <Segmented<Status>
                  value={status}
                  onChange={setStatus}
                  options={[
                    { label: "未使用", value: "unused" },
                    { label: "已使用", value: "used" },
                    { label: "全部", value: "all" },
                  ]}
                />
                <button
                  onClick={loadRows}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-stone-200 px-3 text-xs font-black text-stone-600 transition hover:bg-stone-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  刷新
                </button>
              </div>
            </div>

            {(message || error) && (
              <div className="px-5 pt-4">
                <div
                  className={`rounded-xl px-4 py-3 text-sm font-bold ${
                    error
                      ? "border border-red-200 bg-red-50 text-red-700"
                      : "border border-emerald-200 bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {error || message}
                  {!error && generatedCodes.length > 0 && (
                    <div className="mt-3 border-t border-emerald-200 pt-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-black text-emerald-600">
                          新生成的兑换码（共 {generatedCodes.length} 个）
                        </span>
                        <button
                          onClick={copyGeneratedCodes}
                          className="inline-flex h-7 items-center gap-1 rounded-full border border-emerald-300 bg-white px-3 text-xs font-black text-emerald-700 transition hover:bg-emerald-100"
                        >
                          {generatedCopied ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          {generatedCopied ? "已复制" : "复制全部"}
                        </button>
                      </div>
                      <div className="max-h-40 overflow-y-auto rounded-lg bg-white/70 p-3 font-mono text-xs leading-6 text-stone-700">
                        {generatedCodes.slice(0, 50).map((row) => (
                          <div key={row.id}>{row.code}</div>
                        ))}
                        {generatedCodes.length > 50 && (
                          <div className="text-stone-400">
                            … 其余 {generatedCodes.length - 50} 个请用「复制全部」获取
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 px-5 py-4">
              <button
                onClick={toggleAllVisible}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-stone-200 px-3 text-xs font-black text-stone-600 transition hover:bg-stone-50"
              >
                <Check className="h-4 w-4" />
                选择未使用
              </button>
              <button
                onClick={() => copyCodes()}
                disabled={!rows.length}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-stone-200 px-3 text-xs font-black text-stone-600 transition hover:bg-stone-50 disabled:opacity-40"
              >
                <Copy className="h-4 w-4" />
                {copyState === "done" ? "已复制" : "复制"}
              </button>
              <button
                onClick={() => exportCsv()}
                disabled={!rows.length}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-stone-200 px-3 text-xs font-black text-stone-600 transition hover:bg-stone-50 disabled:opacity-40"
              >
                <Download className="h-4 w-4" />
                导出 CSV
              </button>
              <button
                onClick={deleteSelected}
                disabled={!selectedUnusedCount || deleting}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-red-50 px-3 text-xs font-black text-red-700 transition hover:bg-red-100 disabled:opacity-40"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                删除选中未使用
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-t border-stone-100 text-left">
                <thead className="bg-stone-50 text-xs font-black uppercase tracking-wide text-stone-400">
                  <tr>
                    <th className="w-12 px-5 py-3"></th>
                    <th className="px-5 py-3">兑换码</th>
                    <th className="px-5 py-3">类型</th>
                    <th className="px-5 py-3">状态</th>
                    <th className="px-5 py-3">使用者</th>
                    <th className="px-5 py-3">使用时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {loading ? (
                    Array.from({ length: 6 }).map((_, index) => (
                      <tr key={index}>
                        <td className="px-5 py-4" colSpan={6}>
                          <div className="h-5 animate-pulse rounded bg-stone-100" />
                        </td>
                      </tr>
                    ))
                  ) : rows.length ? (
                    rows.map((row) => (
                      <tr key={row.id} className="transition hover:bg-stone-50">
                        <td className="px-5 py-4">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(row.id)}
                            disabled={row.is_used}
                            onChange={() => toggleRow(row.id)}
                            className="h-4 w-4 rounded border-stone-300 text-emerald-500 focus:ring-emerald-500"
                          />
                        </td>
                        <td className="px-5 py-4 font-mono text-sm font-black text-stone-900">{row.code}</td>
                        <td className="px-5 py-4 text-sm font-bold text-stone-600">{rowValue(row)}</td>
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-black ${
                              row.is_used
                                ? "bg-stone-100 text-stone-500"
                                : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {row.is_used ? "已使用" : "未使用"}
                          </span>
                        </td>
                        <td className="max-w-[180px] truncate px-5 py-4 text-xs font-semibold text-stone-500">
                          {row.used_by ?? "未使用"}
                        </td>
                        <td className="px-5 py-4 text-xs font-semibold text-stone-500">
                          {row.used_at ? new Date(row.used_at).toLocaleString("zh-CN") : "无"}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-5 py-16 text-center">
                        <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                          <KeyRound className="h-8 w-8 text-stone-300" />
                          <p className="text-sm font-black text-stone-700">这里还没有兑换码</p>
                          <p className="text-xs font-semibold text-stone-400">左侧生成后会自动出现在这里。</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black text-stone-400">{label}</p>
      <p className="mt-2 text-2xl font-black tabular-nums text-stone-900">{value}</p>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
}) {
  return (
    <div className="flex rounded-full bg-stone-100 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-full px-3 py-1.5 text-xs font-black transition ${
            value === option.value
              ? "bg-white text-emerald-700 shadow-sm"
              : "text-stone-500 hover:text-stone-800"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
