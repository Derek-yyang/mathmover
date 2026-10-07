"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TYPE_MAP } from "@/lib/constants";
import {
  listGenerations,
  updateGenerationTitle,
  deleteGenerations,
  onGenerationsChanged,
  GenerationRecord,
} from "@/lib/local-store";
import SettingsModal from "./SettingsModal";
import {
  Plus,
  Settings2,
  Clock,
  MoreHorizontal,
  Edit2,
  Trash2,
  X,
  Check,
} from "lucide-react";

export default function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 状态管理
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingItem, setDeletingItem] = useState<string | null>(null);

  // 批量操作状态
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [isBatchDeleteConfirmOpen, setIsBatchDeleteConfirmOpen] = useState(false);

  // 点击外部关闭菜单
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isDashboard = pathname === "/dashboard";
  const currentHistoryId = searchParams.get("history_id");

  const refreshHistory = () => setHistory(listGenerations());

  useEffect(() => {
    refreshHistory();
    return onGenerationsChanged(refreshHistory);
  }, []);

  // 原地重命名逻辑
  const isPreventSaveRef = useRef(false);

  const startEditing = (item: GenerationRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveMenuId(null);
    setEditingId(item.id);
    setEditName(item.title || TYPE_MAP[item.problem_type || ""] || "未命名课件");
  };

  const submitEdit = () => {
    if (isPreventSaveRef.current) {
      isPreventSaveRef.current = false;
      setEditingId(null);
      return;
    }
    if (!editingId) return;

    const newTitle = editName.trim() || "未命名课件";
    const targetId = editingId;

    // 乐观更新
    setHistory((prev) =>
      prev.map((item) => (item.id === targetId ? { ...item, title: newTitle } : item))
    );
    setEditingId(null);
    updateGenerationTitle(targetId, newTitle);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      isPreventSaveRef.current = true;
      setEditingId(null);
    }
  };

  // 删除逻辑
  const confirmDelete = (item: GenerationRecord) => {
    const isCurrent = item.id === currentHistoryId;

    // 乐观更新
    setHistory((prev) => prev.filter((h) => h.id !== item.id));
    setActiveMenuId(null);
    setDeletingItem(null);
    deleteGenerations([item.id]);

    if (isCurrent) {
      router.push("/dashboard?action=new");
    }
  };

  // 批量操作逻辑
  const toggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    setSelectedProjectIds(new Set());
    setIsBatchDeleteConfirmOpen(false);
  };

  const toggleProjectSelection = (id: string) => {
    const newSet = new Set(selectedProjectIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedProjectIds(newSet);
  };

  const handleToggleSelectAll = () => {
    if (selectedProjectIds.size === history.length) {
      setSelectedProjectIds(new Set());
    } else {
      setSelectedProjectIds(new Set(history.map((item) => item.id)));
    }
  };

  const handleBatchDelete = () => {
    if (selectedProjectIds.size === 0) return;

    // 如果当前选中的项目被删除了，跳转到新建
    if (currentHistoryId && selectedProjectIds.has(currentHistoryId)) {
      router.push("/dashboard?action=new");
    }

    setHistory((prev) => prev.filter((item) => !selectedProjectIds.has(item.id)));
    deleteGenerations(Array.from(selectedProjectIds));

    setIsSelectionMode(false);
    setSelectedProjectIds(new Set());
    setIsBatchDeleteConfirmOpen(false);
  };

  return (
    <>
      <aside className="w-64 bg-[#FDFCF8] border-r border-stone-200 flex flex-col z-30 flex-shrink-0 h-full relative">
        {/* 顶部 Logo 区 */}
        <Link href="/" className="p-6 flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-sm transform -rotate-2">
            M
          </div>
          <span className="font-bold text-lg tracking-tight text-stone-800">MathMover</span>
        </Link>

        {/* Dashboard Fixed Top Content */}
        {isDashboard && (
          <div className="flex-shrink-0 z-10 bg-[#FDFCF8]">
            <div className="px-4 pb-4 space-y-4 border-b border-stone-100/50">
              {/* 新建按钮 */}
              <button
                onClick={() => router.push("/dashboard?action=new")}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-4 rounded-full flex items-center justify-center gap-2 transition-all active:scale-[0.98] duration-200 shadow-sm"
              >
                <Plus className="w-5 h-5 stroke-[3]" />
                <span>新建课件</span>
              </button>
            </div>

            {/* 最近历史标题行 (Fixed) */}
            <div className="px-5 py-3 text-xs font-black text-stone-400 uppercase tracking-wider flex items-center justify-between bg-[#FDFCF8]">
              <span>最近历史</span>
              <div className="flex items-center gap-3">
                {history.length > 0 && (
                  <>
                    {isSelectionMode && (
                      <button
                        onClick={handleToggleSelectAll}
                        className="text-xs font-bold text-emerald-600 hover:text-emerald-700 transition-colors"
                      >
                        {selectedProjectIds.size === history.length ? "取消全选" : "全选"}
                      </button>
                    )}
                    <button
                      onClick={toggleSelectionMode}
                      className={`text-[10px] font-bold px-2 py-0.5 rounded transition-colors ${
                        isSelectionMode
                          ? "bg-stone-200 text-stone-600 hover:bg-stone-300"
                          : "bg-stone-100 text-stone-500 hover:bg-emerald-100 hover:text-emerald-600"
                      }`}
                    >
                      {isSelectionMode ? "取消" : "选择"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Scrollable Middle Content */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-6 scrollbar-thin scrollbar-thumb-stone-200 scrollbar-track-transparent">
          {isDashboard && (
            <div className="space-y-2 pb-24">
              {history.length === 0 ? (
                <div className="text-xs text-stone-400 px-3 py-2 italic">暂无历史记录</div>
              ) : (
                history.map((item) => {
                  const isActive = item.id === currentHistoryId;
                  const isSelected = selectedProjectIds.has(item.id);

                  return (
                    <div
                      key={item.id}
                      className={`relative group rounded-xl transition-all duration-200 ${
                        isSelectionMode
                          ? isSelected
                            ? "bg-emerald-50/50 border border-emerald-200 shadow-sm"
                            : "bg-transparent border border-transparent hover:bg-stone-50"
                          : isActive
                            ? "bg-emerald-50/80 shadow-sm"
                            : "hover:bg-white hover:shadow-sm"
                      }`}
                    >
                      <button
                        onClick={() => {
                          if (isSelectionMode) {
                            toggleProjectSelection(item.id);
                          } else {
                            router.push(`/dashboard?history_id=${item.id}`);
                          }
                        }}
                        className="w-full flex items-center gap-3 p-2 text-left"
                      >
                        {isSelectionMode ? (
                          <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                              isSelected
                                ? "bg-emerald-500 border-emerald-500"
                                : "border-stone-300 bg-white group-hover:border-emerald-300"
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3 text-white stroke-[4]" />}
                          </div>
                        ) : (
                          <div
                            className={`w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 border transition-colors ${isActive ? "border-emerald-200" : "bg-stone-100 border-stone-100"}`}
                          >
                            {item.thumbnail ? (
                              <img src={item.thumbnail} alt="缩略图" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-stone-300">
                                <Clock className="w-4 h-4" />
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex-1 min-w-0 pr-6">
                          {editingId === item.id ? (
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onBlur={submitEdit}
                              onKeyDown={handleEditKeyDown}
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                              className="w-full text-xs font-bold bg-white border border-emerald-500 rounded-lg px-2 py-1 text-stone-700 focus:outline-none focus:ring-4 focus:ring-emerald-100/50 transition-all duration-200"
                            />
                          ) : (
                            <div
                              className={`text-xs font-bold truncate transition-colors ${
                                isSelectionMode
                                  ? "text-stone-700"
                                  : isActive
                                    ? "text-emerald-800"
                                    : "text-stone-700"
                              }`}
                            >
                              {item.title || TYPE_MAP[item.problem_type || ""] || "未命名课件"}
                            </div>
                          )}
                          <div className="text-[10px] text-stone-400 font-bold truncate mt-0.5">
                            {new Date(item.created_at).toLocaleString("zh-CN", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>
                      </button>

                      {/* 操作菜单触发器 (非选择模式下显示) */}
                      {!isSelectionMode && (
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuId(activeMenuId === item.id ? null : item.id);
                            }}
                            className={`p-1.5 rounded-lg hover:bg-stone-200/50 text-stone-400 hover:text-stone-600 ${activeMenuId === item.id ? "bg-stone-200/50 text-stone-600 opacity-100" : ""}`}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      {/* 下拉菜单 */}
                      {activeMenuId === item.id && (
                        <div
                          ref={menuRef}
                          className="absolute right-0 top-8 z-50 w-36 bg-white rounded-xl shadow-xl border border-stone-100 overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top-right"
                        >
                          {deletingItem === item.id ? (
                            <div className="p-2 space-y-2">
                              <div className="text-[10px] font-bold text-stone-500 px-1 text-center">确定删除吗？</div>
                              <div className="flex gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeletingItem(null);
                                  }}
                                  className="flex-1 py-1.5 text-xs font-bold text-stone-500 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
                                >
                                  取消
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    confirmDelete(item);
                                  }}
                                  className="flex-1 py-1.5 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors shadow-sm"
                                >
                                  删除
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={(e) => startEditing(item, e)}
                                className="w-full text-left px-3 py-2.5 text-xs font-bold text-stone-600 hover:bg-stone-50 hover:text-emerald-600 flex items-center gap-2"
                              >
                                <Edit2 className="w-3 h-3" /> 重命名
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingItem(item.id);
                                }}
                                className="w-full text-left px-3 py-2.5 text-xs font-bold text-stone-600 hover:bg-red-50 hover:text-red-600 flex items-center gap-2 border-t border-stone-50"
                              >
                                <Trash2 className="w-3 h-3" /> 删除
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* 批量操作条 */}
        <div className="flex-shrink-0 px-4 transition-all duration-300 ease-in-out">
          {isDashboard && isSelectionMode && selectedProjectIds.size > 0 ? (
            <div className="bg-stone-800 text-white rounded-xl shadow-xl p-2 h-12 flex items-center justify-between animate-in slide-in-from-bottom-2 fade-in duration-300 whitespace-nowrap overflow-hidden mb-2">
              {!isBatchDeleteConfirmOpen && (
                <div className="flex items-center gap-2 pl-2">
                  <span className="text-xs font-bold text-stone-400">已选</span>
                  <span className="text-sm font-black text-white bg-stone-700 px-2 py-0.5 rounded-lg min-w-[24px] text-center">
                    {selectedProjectIds.size}
                  </span>
                </div>
              )}

              {isBatchDeleteConfirmOpen ? (
                <div className="flex items-center gap-2 w-full justify-between px-1">
                  <span className="text-xs font-bold text-stone-300">确定删除?</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsBatchDeleteConfirmOpen(false)}
                      className="w-8 h-8 flex items-center justify-center hover:bg-stone-700 rounded-lg text-stone-400 hover:text-white transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                    <button
                      onClick={handleBatchDelete}
                      className="h-8 px-3 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
                    >
                      <Trash2 className="w-4 h-4" /> 确认
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsBatchDeleteConfirmOpen(true)}
                  className="h-8 px-3 bg-stone-700 hover:bg-red-500/20 hover:text-red-400 text-stone-300 text-xs font-bold rounded-lg transition-colors flex items-center gap-2 ml-auto"
                >
                  <Trash2 className="w-4 h-4" /> 删除
                </button>
              )}
            </div>
          ) : null}
        </div>

        {/* 底部：设置 */}
        <div className="px-4 pt-4 pb-2 flex-shrink-0">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-3 w-full p-2 rounded-xl text-left hover:bg-stone-100 active:scale-[0.99] transition-all duration-200 ease-out"
          >
            <div className="w-10 h-10 flex items-center justify-center flex-shrink-0 text-emerald-500">
              <Settings2 className="w-[22px] h-[22px] stroke-[1.5]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-stone-700">设置</div>
            </div>
          </button>
        </div>
      </aside>

      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </>
  );
}
