"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { TYPE_MAP } from "@/lib/constants";
import {
  Plus,
  Settings,
  LayoutGrid,
  Clock,
  User as UserIcon,
  CreditCard,
  Image as ImageIcon,
  LogOut,
  ArrowLeft,
  Loader2,
  Gift,
  MoreHorizontal,
  Edit2,
  Trash2,
  X,
  Check,
  AlertTriangle
} from "lucide-react";
import { motion } from "framer-motion";

export default function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<any>(null);
  const [credits, setCredits] = useState<{ total: number; monthly: number; permanent: number }>({ total: 0, monthly: 0, permanent: 0 });
  const [history, setHistory] = useState<any[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  
  // 状态管理
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null); // 原地编辑 ID
  const [editName, setEditName] = useState(""); // 原地编辑内容
  const [deletingItem, setDeletingItem] = useState<any>(null);
  
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
        // 如果点击外部，也可以选择提交或取消，这里选择取消编辑态（视需求而定，或者保持直到回车/失焦）
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 仅在 dashboard 页面加载历史记录
  const isDashboard = pathname === '/dashboard';
  const isProfile = pathname.startsWith('/dashboard/profile');
  
  // 从 URL 获取当前激活的 Tab (仅用于 Profile 页面)
  const currentTab = searchParams.get('tab') || 'account';
  const currentHistoryId = searchParams.get('history_id');

  const fetchCredits = async (userId: string) => {
    await supabase.rpc('sync_user_credits', { user_uuid: userId });

    const { data } = await supabase
      .from('profiles')
      .select('monthly_credits, permanent_credits')
      .eq('id', userId)
      .single();
    if (data) {
        const monthly = data.monthly_credits || 0;
        const permanent = data.permanent_credits || 0;
        setCredits({
            total: monthly + permanent,
            monthly,
            permanent
        });
    }
  };

  const fetchHistory = async (userId: string) => {
    setIsHistoryLoading(true);
    const { data } = await supabase
      .from('generations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    setHistory(data || []);
    setIsHistoryLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        fetchCredits(session.user.id);
        if (isDashboard) {
            fetchHistory(session.user.id);
        }
      }
    };
    init();

    // 监听积分变化 (通过自定义事件或轮询，这里简单起见每次路径变化都刷新)
    // 实际生产中建议使用 Context 或 SWR
  }, [pathname]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.replace('/login');
  };

  // 原地重命名逻辑
  const isPreventSaveRef = useRef(false);

  const startEditing = (item: any, e: React.MouseEvent) => {
      e.stopPropagation();
      setActiveMenuId(null);
      setEditingId(item.id);
      setEditName(item.title || TYPE_MAP[item.problem_type] || '未命名课件');
  };

  const submitEdit = async () => {
      if (isPreventSaveRef.current) {
          isPreventSaveRef.current = false;
          setEditingId(null);
          return;
      }
      if (!editingId) return;
      
      const newTitle = editName.trim() || '未命名课件';
      const targetId = editingId;

      // 乐观更新
      setHistory(prev => prev.map(item => 
          item.id === targetId ? { ...item, title: newTitle } : item
      ));
      
      setEditingId(null);

      const { error } = await supabase
          .from('generations')
          .update({ title: newTitle })
          .eq('id', targetId);
      
      if (error) {
          console.error('Rename failed:', error);
          fetchHistory(user.id); // 回滚
      }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
      } else if (e.key === 'Escape') {
          isPreventSaveRef.current = true;
          setEditingId(null); // 取消
      }
  };

  // 辅助函数：从 URL 提取 Storage 路径
  const getFilePathFromUrl = (url: string): string | null => {
      if (!url) return null;
      try {
          // 假设 URL 格式为: .../storage/v1/object/public/problem-images/USER_ID/FILENAME
          const marker = '/problem-images/';
          const index = url.indexOf(marker);
          if (index !== -1) {
              const fullPath = url.substring(index + marker.length);
              // 移除可能存在的 URL 参数 (如 ?t=123)
              return fullPath.split('?')[0];
          }
          return null;
      } catch (e) {
          console.error('Error parsing file path:', e);
          return null;
      }
  };

  const removeUnreferencedStorageFiles = async (filePaths: string[]) => {
      const uniquePaths = Array.from(new Set(filePaths.filter(Boolean)));
      if (uniquePaths.length === 0) return;

      const pathsToDelete: string[] = [];
      for (const filePath of uniquePaths) {
          const { count, error } = await supabase
              .from('generations')
              .select('id', { count: 'exact', head: true })
              .like('image_url', `%/problem-images/${filePath}%`);

          if (error) {
              console.warn('Failed to check image references:', error);
              continue;
          }

          if ((count ?? 0) === 0) {
              pathsToDelete.push(filePath);
          }
      }

      if (pathsToDelete.length === 0) return;

      const { error: storageError } = await supabase.storage
          .from('problem-images')
          .remove(pathsToDelete);

      if (storageError) {
          console.warn('Failed to delete image files:', storageError);
      }
  };

  // 删除逻辑
  const confirmDelete = async (item: any) => {
      if (!user) return;

      const isCurrent = item.id === currentHistoryId;
      const filePath = item.image_url ? getFilePathFromUrl(item.image_url) : null;
      
      // 乐观更新
      setHistory(prev => prev.filter(h => h.id !== item.id));
      setActiveMenuId(null);
      setDeletingItem(null); // Clear deleting state

      const { data: deletedRows, error } = await supabase
          .from('generations')
          .delete()
          .eq('id', item.id)
          .eq('user_id', user.id)
          .select('id');
      
      if (error || !deletedRows || deletedRows.length === 0) {
          console.error('Delete failed:', error);
          fetchHistory(user.id); // 回滚
          return;
      }

      if (filePath) {
          await removeUnreferencedStorageFiles([filePath]);
      }

      if (isCurrent) {
          router.push('/dashboard?action=new');
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
          // 如果已全选，则取消全选
          setSelectedProjectIds(new Set());
      } else {
          // 否则全选
          setSelectedProjectIds(new Set(history.map(item => item.id)));
      }
  };

  const handleBatchDelete = async () => {
      if (!user) return;
      if (selectedProjectIds.size === 0) return;
      
      const idsToDelete = Array.from(selectedProjectIds);
      const itemsToDelete = history.filter(item => selectedProjectIds.has(item.id));
      
      // 乐观更新
      setHistory(prev => prev.filter(item => !selectedProjectIds.has(item.id)));
      
      // 如果当前选中的项目被删除了，跳转到新建
      if (currentHistoryId && selectedProjectIds.has(currentHistoryId)) {
          router.push('/dashboard?action=new');
      }

      setIsSelectionMode(false);
      setSelectedProjectIds(new Set());
      setIsBatchDeleteConfirmOpen(false);

      const { data: deletedRows, error } = await supabase
          .from('generations')
          .delete()
          .in('id', idsToDelete)
          .eq('user_id', user.id)
          .select('id');
      
      if (error || !deletedRows || deletedRows.length === 0) {
          console.error('Batch delete failed:', error);
          fetchHistory(user.id); // 回滚
          return;
      }

      const deletedIds = new Set(deletedRows.map(row => row.id));
      const deletedFilePaths = itemsToDelete
          .filter(item => deletedIds.has(item.id))
          .map(item => item.image_url ? getFilePathFromUrl(item.image_url) : null)
          .filter((path): path is string => Boolean(path));

      if (deletedFilePaths.length > 0) {
          await removeUnreferencedStorageFiles(deletedFilePaths);
      }
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
                  onClick={() => router.push('/dashboard?action=new')} 
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-4 rounded-full flex items-center justify-center gap-2 transition-all active:scale-[0.98] duration-200 shadow-sm"
                >
                    <Plus className="w-5 h-5 stroke-[3]" />
                    <span>新建课件</span>
                </button>

                {/* 积分卡片 */}
                <div className="flex items-center justify-between px-3 py-2 bg-stone-50 rounded-xl border border-stone-100 relative group">
                   <div className="flex flex-col relative">
                       <span className="text-xs font-bold text-stone-400">剩余积分</span>
                       <span className="text-xl font-black text-emerald-600 cursor-default">{credits.total}</span>
                       
                       {/* 积分详情悬浮窗 */}
                       <div className="absolute top-full left-0 mt-2 w-max bg-zinc-800 text-white text-xs rounded-lg p-3 shadow-xl z-50 opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 origin-top-left flex flex-col gap-1.5 border border-zinc-700/50">
                           {/* 小三角形 */}
                           <div className="absolute -top-1 left-4 w-2 h-2 bg-zinc-800 rotate-45 border-t border-l border-zinc-700/50"></div>
                           
                           <div className="flex items-center justify-between gap-4">
                               <span className="text-zinc-400">月度积分</span>
                               <span className="font-bold font-mono">{credits.monthly}</span>
                           </div>
                           <div className="flex items-center justify-between gap-4 border-t border-zinc-700 pt-1.5">
                               <span className="text-zinc-400">永久积分</span>
                               <span className="font-bold font-mono text-emerald-400">{credits.permanent}</span>
                           </div>
                       </div>
                   </div>
                   <button 
                       onClick={() => router.push('/dashboard/profile?tab=credits')}
                       className="px-3 py-1.5 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full hover:bg-emerald-200 transition-colors"
                   >
                       兑换
                   </button>
                </div>
            </div>

            {/* 最近历史标题行 (Fixed) */}
            <div className="px-5 py-3 text-xs font-black text-stone-400 uppercase tracking-wider flex items-center justify-between bg-[#FDFCF8]">
                <span>最近历史</span>
                <div className="flex items-center gap-3">
                    {isHistoryLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                    {!isHistoryLoading && history.length > 0 && (
                        <>
                            {isSelectionMode && (
                                <button 
                                    onClick={handleToggleSelectAll}
                                    className="text-xs font-bold text-emerald-600 hover:text-emerald-700 transition-colors"
                                >
                                    {selectedProjectIds.size === history.length ? '取消全选' : '全选'}
                                </button>
                            )}
                            <button 
                                onClick={toggleSelectionMode}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded transition-colors ${
                                    isSelectionMode 
                                    ? 'bg-stone-200 text-stone-600 hover:bg-stone-300' 
                                    : 'bg-stone-100 text-stone-500 hover:bg-emerald-100 hover:text-emerald-600'
                                }`}
                            >
                                {isSelectionMode ? '取消' : '选择'}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* Scrollable Middle Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-6 scrollbar-thin scrollbar-thumb-stone-200 scrollbar-track-transparent">
        
        {/* === 场景 1: 工作台 (Dashboard) History === */}
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
                                          ? 'bg-emerald-50/50 border border-emerald-200 shadow-sm'
                                          : 'bg-transparent border border-transparent hover:bg-stone-50'
                                      : isActive 
                                          ? 'bg-emerald-50/80 shadow-sm' 
                                          : 'hover:bg-white hover:shadow-sm'
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
                                       <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                                           isSelected 
                                           ? 'bg-emerald-500 border-emerald-500' 
                                           : 'border-stone-300 bg-white group-hover:border-emerald-300'
                                       }`}>
                                           {isSelected && <Check className="w-3 h-3 text-white stroke-[4]" />}
                                       </div>
                                   ) : (
                                       <div className={`w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 border transition-colors ${isActive ? 'border-emerald-200' : 'bg-stone-100 border-stone-100'}`}>
                                           {item.image_url ? (
                                               <img src={item.image_url} alt="缩略图" className="w-full h-full object-cover" />
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
                                           <div className={`text-xs font-bold truncate transition-colors ${
                                               isSelectionMode 
                                                  ? 'text-stone-700'
                                                  : isActive ? 'text-emerald-800' : 'text-stone-700'
                                           }`}>
                                               {item.title || TYPE_MAP[item.problem_type] || '未命名课件'}
                                           </div>
                                       )}
                                       <div className="text-[10px] text-stone-400 font-bold truncate mt-0.5">
                                           {new Date(item.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
                                           className={`p-1.5 rounded-lg hover:bg-stone-200/50 text-stone-400 hover:text-stone-600 ${activeMenuId === item.id ? 'bg-stone-200/50 text-stone-600 opacity-100' : ''}`}
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

        {/* === 场景 2: 个人中心 (Profile) === */}
        {isProfile && (
            <>
               <button 
                  onClick={() => router.push('/dashboard')}
                  className="flex items-center gap-2 text-stone-500 hover:text-emerald-600 font-bold transition-colors mb-6 group w-full px-2"
               >
                  <div className="p-1.5 rounded-lg bg-stone-100 group-hover:bg-emerald-100 transition-colors">
                     <ArrowLeft className="w-4 h-4" />
                  </div>
                  <span>返回编辑器</span>
               </button>
               
               <div className="flex flex-col items-center mb-6 px-4">
                  <div className="w-16 h-16 bg-emerald-50 border border-emerald-100 rounded-full flex items-center justify-center text-emerald-600 mb-3 shadow-sm">
                      <UserIcon className="w-8 h-8 stroke-[2.5]" />
                  </div>
                  <h2 className="font-bold text-stone-800 truncate max-w-full text-sm">{user?.email || '未命名用户'}</h2>
               </div>

               <nav className="space-y-1">
                  <button 
                    onClick={() => router.push('/dashboard/profile?tab=account')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 duration-75 ${
                        currentTab === 'account' 
                        ? 'bg-emerald-50 text-emerald-700 shadow-sm' 
                        : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'
                    }`}
                  >
                     <UserIcon className="w-4 h-4" /> 账户信息
                  </button>
                  <button 
                    onClick={() => router.push('/dashboard/profile?tab=credits')}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-all active:scale-95 duration-75 ${
                        currentTab === 'credits' 
                        ? 'bg-emerald-50 text-emerald-700 shadow-sm' 
                        : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'
                    }`}
                  >
                     <CreditCard className="w-4 h-4" /> 积分与充值
                  </button>
               </nav>
            </>
        )}
      </div>

      {/* 批量操作条 (Placed between List and Bottom Profile) */}
      <div className="flex-shrink-0 px-4 transition-all duration-300 ease-in-out">
          {isDashboard && isSelectionMode && selectedProjectIds.size > 0 ? (
              <div className="bg-stone-800 text-white rounded-xl shadow-xl p-2 h-12 flex items-center justify-between animate-in slide-in-from-bottom-2 fade-in duration-300 whitespace-nowrap overflow-hidden mb-2">
                  {!isBatchDeleteConfirmOpen && (
                      <div className="flex items-center gap-2 pl-2">
                          <span className="text-xs font-bold text-stone-400">已选</span>
                          <span className="text-sm font-black text-white bg-stone-700 px-2 py-0.5 rounded-lg min-w-[24px] text-center">{selectedProjectIds.size}</span>
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
          ) : (
             // Placeholder to prevent layout jump or keep empty space if needed, 
             // but here we just render nothing or minimal height.
             // To be completely smooth, we could animate height, but for now conditional rendering is fine.
             // If we want zero height when hidden:
             null
          )}
      </div>

      {/* 底部用户区 */}
      <div className="p-4 border-t border-stone-200 bg-stone-50/50 flex-shrink-0">
          {isDashboard ? (
              user ? (
                <button 
                    onClick={() => router.push('/dashboard/profile')}
                    className="flex items-center gap-3 w-full p-2 rounded-xl hover:bg-white transition-all text-left group border border-transparent hover:border-stone-200 hover:shadow-sm active:scale-95 duration-75"
                >
                    <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0 shadow-sm">
                        <UserIcon className="w-5 h-5 stroke-[2.5]" />
                    </div>
                    <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-stone-700 group-hover:text-stone-900 truncate">
                        {user.email || '已登录用户'}
                    </div>
                    <div className="text-xs text-stone-400 group-hover:text-emerald-500 font-bold">查看个人中心</div>
                    </div>
                    <Settings className="w-4 h-4 text-stone-300 group-hover:text-emerald-500" />
                </button>
              ) : (
                <Link href="/login" className="flex items-center gap-3 w-full p-2 rounded-xl hover:bg-white transition-all text-left group border border-transparent hover:border-stone-200 hover:shadow-sm">
                    <div className="w-10 h-10 rounded-full bg-stone-100 border-2 border-stone-200 flex items-center justify-center text-stone-400 font-black text-sm">?</div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-stone-700 group-hover:text-stone-900">未登录</div>
                    </div>
                </Link>
              )
          ) : (
              <button 
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm text-red-500 hover:bg-red-50 transition-all active:scale-95 duration-75"
              >
                <LogOut className="w-4 h-4" /> 退出登录
              </button>
          )}
      </div>
    </aside>

    {/* Modals placed outside aside to ensure z-index stacking works relative to viewport if needed, 
        but here we use fixed positioning so location in DOM matters less, provided no transform parents. 
        Note: framer-motion in layout might create transform context, so fixed might be relative to that.
        If Sidebar is fixed or sticky, it might be fine. 
    */}
    
    {/* Rename Modal Removed */}

    {/* Delete Modal Removed */}
    </>
  );
}
