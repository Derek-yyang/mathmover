"use client";

import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, PanelLeftClose, PanelLeftOpen, SquarePen, Settings2, MoreHorizontal, Edit2, Trash2, X, Check } from 'lucide-react';
import { TYPE_MAP } from '@/lib/constants';
import { libraryRequest, migrateLegacyHistory, renameCourseware, deleteCoursewares, type CoursewareSummary } from '@/lib/courseware-client';
import { groupSidebarHistory } from '@/lib/sidebar-history';
import { useSidebarState } from './dashboard/SidebarState';
import SidebarRailButton from './dashboard/SidebarRailButton';
import SettingsModal from './SettingsModal';
import LocalLibraryTools from './dashboard/LocalLibraryTools';
import { useAgentRuntimeState } from './dashboard/AgentRuntimeState';

const iconButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-200/60 hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-emerald-700';
const rowButton = 'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-stone-800 hover:bg-stone-200/50 focus-visible:outline-2 focus-visible:outline-emerald-700';
const titleOf = (item: CoursewareSummary) => item.title || TYPE_MAP[item.problem_type || ''] || '未命名课件';

export default function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const currentHistoryId = useSearchParams().get('history_id');
  const sidebar = useSidebarState();
  const [history, setHistory] = useState<CoursewareSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const { busy } = useAgentRuntimeState();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [menu, setMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  const [deletingItem, setDeletingItem] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editingRef = useRef<string | null>(null);
  const returnFocusId = useRef<string | null>(null);
  const historyListId = useId();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchConfirm, setBatchConfirm] = useState(false);
  const isDashboard = pathname === '/dashboard';
  const groups = groupSidebarHistory(history.map(item => ({ ...item, title: titleOf(item) })), query, now);
  const visibleIds = groups.flatMap(group => group.items.map(item => item.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        await migrateLegacyHistory();
        const { records } = await libraryRequest<{ records: CoursewareSummary[] }>();
        if (!active) return;
        setHistory(records); setHistoryError(null);
        setSelectedIds(previous => new Set([...previous].filter(id => records.some(item => item.id === id))));
      } catch (e) { if (active) setHistoryError(e instanceof Error ? e.message : String(e)); }
      finally { if (active) setHistoryLoading(false); }
    };
    const changed = () => { void refresh(); };
    changed(); window.addEventListener('mathmover_coursewares_changed', changed);
    const timer = setInterval(changed, 10_000);
    return () => { active = false; clearInterval(timer); window.removeEventListener('mathmover_coursewares_changed', changed); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => { if (searchOpen && !sidebar?.collapsed) searchRef.current?.focus(); }, [searchOpen, sidebar?.collapsed]);

  useEffect(() => {
    if (editingId || !returnFocusId.current) return;
    const button = document.getElementById(`${historyListId}-${returnFocusId.current}`);
    returnFocusId.current = null;
    (button || searchRef.current || searchButtonRef.current)?.focus();
  }, [editingId, historyListId]);

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = () => { setMenu(null); setDeletingItem(null); };
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !menuTriggerRef.current?.contains(event.target as Node)) close();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); menuTriggerRef.current?.focus(); }
    };
    const scroll = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keydown);
    window.addEventListener('resize', close);
    document.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [menu]);

  const resetSelection = () => { setSelectedIds(new Set()); setBatchConfirm(false); };
  const closeSearch = () => { setSearchOpen(false); setQuery(''); resetSelection(); searchButtonRef.current?.focus(); };
  const submitEdit = async (restoreFocus = false) => {
    if (busy) return;
    const id = editingRef.current;
    if (!id) return;
    if (restoreFocus) returnFocusId.current = id;
    editingRef.current = null;
    setEditingId(null);
    const item = history.find(item => item.id === id);
    if (!item) return;
    try { await renameCourseware(id, editName.trim() || '未命名课件', item.revision); }
    catch (e) { setHistoryError(e instanceof Error ? e.message : String(e)); }
  };
  const deleteItems = async (ids: string[]) => {
    if (busy) return;
    try { await deleteCoursewares(ids); } catch (e) { setHistoryError(e instanceof Error ? e.message : String(e)); return; }
    setMenu(null); setDeletingItem(null); setBatchConfirm(false); setSelectionMode(false); setSelectedIds(new Set());
    if (currentHistoryId && ids.includes(currentHistoryId)) router.push('/dashboard?action=new');
    else menuTriggerRef.current?.focus();
  };

  return (
    <>
      <div className="dashboard-sidebar relative z-30 h-full shrink-0 bg-[#FDFCF8]" data-collapsed={sidebar?.collapsed ? 'true' : 'false'}>
        <aside aria-label="快捷侧栏" aria-hidden={!sidebar?.collapsed} inert={!sidebar?.collapsed}
          className="sidebar-rail absolute inset-y-0 left-0 flex w-14 flex-col items-center border-r border-stone-200 bg-[#FDFCF8]">
          <div className="flex h-14 shrink-0 items-center">
            <SidebarRailButton id={sidebar?.openButtonId} label="展开侧栏" controls={sidebar?.sidebarId} expanded={false} onClick={() => sidebar?.toggleSidebar()}>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-700 text-sm font-bold text-white group-hover:hidden group-focus-visible:hidden">M</span>
              <PanelLeftOpen className="hidden h-5 w-5 group-hover:block group-focus-visible:block" />
            </SidebarRailButton>
          </div>
          {isDashboard && <div className="flex flex-col gap-1">
            <SidebarRailButton label="新建课件" onClick={() => { if (!busy) router.push('/dashboard?action=new'); }}><SquarePen className="h-5 w-5" /></SidebarRailButton>
            <SidebarRailButton label="搜索课件" controls="sidebar-search" expanded={false} onClick={() => {
              setMenu(null);
              setSearchOpen(true);
              sidebar?.expandSidebar();
            }}><Search className="h-5 w-5" /></SidebarRailButton>
          </div>}
          <div className="mt-auto py-2">
            <SidebarRailButton label="设置" onClick={() => setIsSettingsOpen(true)}><Settings2 className="h-5 w-5" /></SidebarRailButton>
          </div>
        </aside>
      <div className="sidebar-expanded-clip absolute inset-0 overflow-hidden" inert={sidebar?.collapsed} aria-hidden={sidebar?.collapsed}>
      <aside id={sidebar?.sidebarId} aria-label="课件侧栏"
        className="sidebar-expanded flex h-full w-64 flex-col border-r border-stone-200 bg-[#FDFCF8]">
        <div className="flex h-14 shrink-0 items-center gap-1 px-3">
          <Link href="/" className="mr-auto flex min-w-0 items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-emerald-700" aria-label="MathMover 首页">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">M</span>
            <span className="text-sm font-semibold text-stone-900">MathMover</span>
          </Link>
          {isDashboard && <button ref={searchButtonRef} type="button" className={iconButton} aria-label="搜索课件" title="搜索课件"
            aria-expanded={searchOpen} aria-controls="sidebar-search" onClick={() => { if (searchOpen) closeSearch(); else { setSearchOpen(true); setMenu(null); } }}>
            <Search className="h-4 w-4" />
          </button>}
          {sidebar && <button id={sidebar.closeButtonId} type="button" className={iconButton} aria-label="收起侧栏" title="收起侧栏"
            aria-expanded={true} aria-controls={sidebar.sidebarId} onClick={() => { setMenu(null); sidebar.toggleSidebar(); }}>
            <PanelLeftClose className="h-4 w-4" />
          </button>}
        </div>

        {isDashboard && <>
          <div className="shrink-0 px-2 pb-3">
            <button type="button" className={rowButton} disabled={busy} onClick={() => router.push('/dashboard?action=new')}>
              <SquarePen className="h-4 w-4 shrink-0 text-emerald-700" /><span>新建课件</span>
            </button>
            {searchOpen && <div id="sidebar-search" className="relative mx-1 mt-2">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-3 h-4 w-4 text-stone-500" />
              <input ref={searchRef} type="search" aria-label="搜索课件标题" placeholder="搜索课件标题" value={query}
                onChange={event => { setQuery(event.target.value); setMenu(null); resetSelection(); }}
                onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeSearch(); } }}
                className="h-10 w-full rounded-lg border border-stone-300 bg-white pl-8 pr-9 text-sm text-stone-800 placeholder:text-stone-600 focus:border-emerald-700 focus:outline-2 focus:outline-emerald-700 [&::-webkit-search-cancel-button]:appearance-none" />
              <button type="button" aria-label="关闭搜索" title="关闭搜索" onClick={closeSearch} className={`${iconButton} absolute right-1 top-1`}><X className="h-4 w-4" /></button>
            </div>}
          </div>
          <div className="flex shrink-0 items-center justify-between px-5 pb-2 text-xs text-stone-600">
            <span>{searchOpen && query.trim() ? '搜索结果' : '最近课件'}</span>
            {history.length > 0 && <button type="button" className="rounded px-1.5 py-1 hover:bg-stone-200/60 focus-visible:outline-2 focus-visible:outline-emerald-700"
              onClick={() => { setSelectionMode(value => !value); setMenu(null); resetSelection(); }}>{selectionMode ? '取消选择' : '选择'}</button>}
          </div>
        </>}

        <nav aria-label="历史课件" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
          {historyError && <p role="alert" className="px-3 py-3 text-xs leading-5 text-amber-900">{historyError}</p>}
          {isDashboard && (groups.length === 0 ? <div className="px-3 py-5 text-sm leading-6 text-stone-600" role="status">
            {historyLoading ? '正在读取本地课件…' : historyError ? '课件列表尚未读取成功。' : history.length === 0 ? '暂无课件，点击“新建课件”开始。' : '没有找到匹配的课件，试试其他标题。'}
          </div> : groups.map(group => <section key={group.label} aria-label={group.label} className="mb-5">
            <h2 className="px-3 pb-2 pt-3 text-xs font-medium text-stone-600">{group.label}</h2>
            <ul className="space-y-0.5">{group.items.map(item => {
              const active = item.id === currentHistoryId;
              const selected = selectedIds.has(item.id);
              return <li key={item.id} className={`group relative rounded-lg ${active || selected ? 'bg-emerald-50 text-emerald-900' : 'text-stone-800 hover:bg-stone-200/50'}`}>
                {editingId === item.id ? <div className="px-2 py-1">
                  <input type="text" aria-label="课件名称" autoFocus value={editName} onChange={event => setEditName(event.target.value)} onBlur={() => submitEdit()}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submitEdit(true); }
                      if (event.key === 'Escape') { event.preventDefault(); returnFocusId.current = item.id; editingRef.current = null; setEditingId(null); }
                    }} className="h-8 w-full rounded border border-emerald-700 bg-white px-2 text-sm text-stone-800 focus:outline-2 focus:outline-emerald-700" />
                </div> : <>
                  <button type="button" id={`${historyListId}-${item.id}`} aria-current={active && !selectionMode ? 'page' : undefined} aria-pressed={selectionMode ? selected : undefined}
                    title={item.title} className={`flex min-h-10 w-full min-w-0 items-center gap-2 rounded-lg py-2 pl-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-emerald-700 ${selectionMode ? 'pr-3' : 'pr-10'}`}
                    onClick={() => {
                      if (busy) return;
                      if (selectionMode) { setBatchConfirm(false); setSelectedIds(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; }); }
                      else router.push(`/dashboard?history_id=${encodeURIComponent(item.id)}`);
                    }}>
                    {selectionMode && <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-stone-400'}`}>{selected && <Check className="h-3 w-3" />}</span>}
                    <span className="truncate">{item.title}</span>
                  </button>
                  {!selectionMode && <button type="button" aria-label={`课件操作：${item.title}`} title="课件操作" aria-haspopup="dialog" aria-expanded={menu?.id === item.id}
                    disabled={busy}
                    className={`absolute right-1 top-1 ${iconButton} ${active || menu?.id === item.id ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100'}`}
                    onClick={event => {
                      if (menu?.id === item.id) { setMenu(null); setDeletingItem(null); return; }
                      const box = event.currentTarget.getBoundingClientRect();
                      menuTriggerRef.current = event.currentTarget;
                      setDeletingItem(null);
                      setMenu({id:item.id, left:Math.max(8, Math.min(box.right - 176, window.innerWidth - 184)), top:Math.max(8, Math.min(box.bottom + 4, window.innerHeight - 140))});
                    }}><MoreHorizontal className="h-4 w-4" /></button>}
                </>}
              </li>;
            })}</ul>
          </section>))}
        </nav>

        {selectionMode && <div className="shrink-0 border-t border-stone-200 px-3 py-3 text-xs text-stone-700">
          <div className="flex items-center justify-between">
            <span aria-live="polite">已选 {selectedIds.size} 项</span>
            <button type="button" disabled={visibleIds.length === 0} className="rounded p-1 text-emerald-800 hover:bg-emerald-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-emerald-700"
              onClick={() => { setSelectedIds(allVisibleSelected ? new Set() : new Set(visibleIds)); setBatchConfirm(false); }}>{allVisibleSelected ? '取消全选' : query.trim() ? '全选结果' : '全选'}</button>
          </div>
          {batchConfirm ? <div className="mt-2 flex items-center justify-between gap-2">
            <span>删除 {selectedIds.size} 个课件？</span>
            <button type="button" className="rounded px-2 py-1 hover:bg-stone-200" onClick={() => setBatchConfirm(false)}>取消</button>
            <button type="button" className="rounded bg-red-700 px-2 py-1 text-white hover:bg-red-800" onClick={() => deleteItems([...selectedIds])}>确认删除</button>
          </div> : <button type="button" disabled={selectedIds.size === 0} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-stone-500 focus-visible:outline-2 focus-visible:outline-red-700"
            onClick={() => setBatchConfirm(true)}><Trash2 className="h-4 w-4" />删除所选课件</button>}
        </div>}

        <div className="shrink-0 border-t border-stone-200/70 p-2">
          <LocalLibraryTools disabled={busy} />
          <button type="button" onClick={() => setIsSettingsOpen(true)} className={rowButton}><Settings2 className="h-4 w-4 text-stone-600" /><span>设置</span></button>
        </div>
      </aside>
      </div>
      </div>

      {menu && createPortal(<div ref={menuRef} role="dialog" aria-label="课件操作" style={{left:menu.left, top:menu.top}}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setMenu(null); setDeletingItem(null); } }}
        className="fixed z-50 w-44 rounded-xl border border-stone-300 bg-white p-1 text-sm text-stone-800">
        {deletingItem === menu.id ? <div className="p-2">
          <p className="mb-2 text-xs leading-5">移入回收站？之后可以在“本地课件库”恢复。</p>
          <div className="flex gap-2"><button type="button" className="flex-1 rounded-lg bg-stone-100 py-2 hover:bg-stone-200" onClick={() => setDeletingItem(null)}>取消</button>
            <button type="button" className="flex-1 rounded-lg bg-red-700 py-2 text-white hover:bg-red-800" onClick={() => deleteItems([menu.id])}>删除</button></div>
        </div> : <>
          <button type="button" className={rowButton} onClick={() => {
            const item = history.find(record => record.id === menu.id);
            if (!item) return;
            editingRef.current = item.id; setEditingId(item.id); setEditName(titleOf(item)); setMenu(null);
          }}><Edit2 className="h-4 w-4" />重命名</button>
          <button type="button" className={`${rowButton} text-red-700 hover:bg-red-50`} onClick={() => setDeletingItem(menu.id)}><Trash2 className="h-4 w-4" />删除</button>
        </>}
      </div>, document.body)}
      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </>
  );
}
