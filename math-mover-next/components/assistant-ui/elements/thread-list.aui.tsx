// Upstream assistant-ui runtime ThreadList; see ../UPSTREAM.md.
"use client";

import { Button } from "@/components/assistant-ui/ui/button";
import { Input } from "@/components/assistant-ui/ui/input";
import { Skeleton } from "@/components/assistant-ui/ui/skeleton";
import { cn } from "@/components/assistant-ui/utils";
import { dropdownMenuContentClassName } from '../ui/dropdown-menu';
import {
  AuiIf,
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  CheckIcon,
  FolderOpenIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "lucide-react";
import {
  forwardRef,
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type FC,
} from "react";
import { AnimatePresence, LayoutGroup, motion, useIsPresent, useReducedMotion } from "framer-motion";
import { Popover as PopoverPrimitive } from 'radix-ui';

type ThreadListSelection = {
  enabled: boolean;
  ids: ReadonlySet<string>;
  onToggleMode: () => void;
  onToggle: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
};
type ThreadListHost = {
  archived?: boolean;
  portalContainer?: HTMLElement | null;
  disabled?: boolean;
  newDisabled?: boolean;
  onNew?: () => void;
  selection?: ThreadListSelection;
  onDeleteRequest?: (ids: string[]) => void;
  onDelete?: (id: string) => Promise<void>;
  onOpen?: (id: string) => void;
  onOpenCurrent?: () => void;
};
const HostContext = createContext<ThreadListHost>({});

export const ThreadList: FC<ThreadListHost & {
  rootRef?: React.Ref<HTMLDivElement>;
  searchRef?: React.Ref<HTMLInputElement>;
  error?: string | null;
  onRetry?: () => void;
}> = ({ rootRef, searchRef, error, onRetry, archived = false, ...host }) => {
  const [search, setSearch] = useState("");
  const currentCount = useAuiState(s => archived ? s.threads.archivedThreadIds.length : s.threads.threadIds.length);

  return (
    <HostContext.Provider value={{ ...host, archived }}>
    <ThreadListRoot ref={rootRef} tabIndex={-1} aria-label={archived ? '归档课件列表' : '最近课件列表'} className={cn('min-h-0 flex-1 gap-1 pb-2 text-[var(--mm-text-stone-800)]', archived ? 'px-0' : 'px-3 pt-2')}>
      {!archived && <ThreadListNew disabled={host.newDisabled ?? host.disabled}
        onClick={host.onNew ? event => { event.preventDefault(); host.onNew?.(); } : undefined}
        className="h-10 shrink-0 rounded-lg bg-transparent px-2.5 font-medium text-[var(--mm-text-stone-800)] hover:bg-[var(--mm-bg-stone-100)] data-active:bg-transparent data-active:hover:bg-[var(--mm-bg-stone-100)] [&_svg]:text-[var(--mm-text-emerald-700)]" />}
      {(currentCount > 0 || search.length > 0) && (
        <ThreadListSearch ref={searchRef} value={search} onValueChange={setSearch} aria-label={archived ? '搜索归档课件' : '搜索课件标题'} placeholder={archived ? '搜索归档课件' : '搜索课件标题'} className="h-9 rounded-lg border-transparent bg-[var(--mm-bg-stone-100)]/80 shadow-none placeholder:text-[var(--mm-text-stone-500)] focus-visible:bg-[var(--mm-surface)]" />
      )}
      {error && <div role="alert" className="px-2.5 py-2 text-xs leading-5 text-[var(--mm-text-amber-900)]">
        {error}
        {onRetry && <button type="button" className="ml-2 rounded underline focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]" onClick={onRetry}>重试</button>}
      </div>}
      {(currentCount > 0 || host.selection?.enabled) && host.selection && <div className="flex shrink-0 items-center justify-between gap-1 pt-2 pb-1 text-xs text-[var(--mm-text-stone-600)]">
        <span className="px-2.5">{archived ? `已归档 (${currentCount})` : '最近课件'}</span>
        <button type="button" disabled={host.disabled} onClick={host.selection.onToggleMode} className="min-h-8 shrink-0 rounded-md px-1.5 py-1.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)] disabled:opacity-50">
          {host.selection.enabled ? '取消选择' : '选择'}
        </button>
      </div>}
      {/* Settings owns archive scrolling; an unbounded inner scroll container
          with overscroll containment would swallow wheel input. */}
      <ThreadListItems searchQuery={search} className={cn('relative min-h-0 pb-3', archived ? 'flex-none overflow-visible' : 'flex-1 overflow-y-auto overscroll-contain')} aria-label="历史课件" />
      {host.selection?.enabled && <ThreadListSelectionBar searchQuery={search} />}
    </ThreadListRoot>
    </HostContext.Provider>
  );
};

const ThreadListSelectionBar: FC<{ searchQuery: string }> = ({ searchQuery }) => {
  const { selection, disabled, onDeleteRequest } = useContext(HostContext);
  const { threadIds, filteredIndices } = useThreadListGroups(searchQuery);
  const visibleIds = filteredIndices.map(index => threadIds[index]);
  if (!selection) return null;
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selection.ids.has(id));
  return <div role="group" aria-label="课件批量操作" data-slot="thread-list-selection-bar"
    className="flex h-9 shrink-0 items-center justify-between gap-2 pl-2.5 pr-1 text-xs text-[var(--mm-text-stone-600)]">
    <span aria-live="polite" aria-atomic="true" className="shrink-0 tabular-nums">已选 {selection.ids.size} 项</span>
    <div className="flex shrink-0 items-center gap-1">
      <Button type="button" variant="ghost" size="sm" disabled={disabled || !visibleIds.length}
        className="h-8 px-2 text-xs font-normal text-[var(--mm-text-emerald-800)] hover:bg-[var(--mm-bg-emerald-50)] hover:text-[var(--mm-text-emerald-800)]"
        onClick={() => selection.onSelectAll(allSelected ? [] : visibleIds)}>{allSelected ? '取消全选' : searchQuery.trim() ? '全选结果' : '全选'}</Button>
      <Button type="button" variant="ghost" size="icon" aria-label="删除所选课件" title="删除所选课件"
        disabled={disabled || !selection.ids.size}
        className="size-8 text-[var(--mm-text-red-700)] hover:bg-[var(--mm-bg-red-50)] hover:text-[var(--mm-text-red-700)] disabled:text-[var(--mm-text-stone-500)] disabled:opacity-50"
        onClick={() => onDeleteRequest?.([...selection.ids])}><TrashIcon aria-hidden="true" className="size-4" /></Button>
    </div>
  </div>;
};

export const ThreadListSearch = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<typeof Input>, "value" | "onChange"> & {
    value: string;
    onValueChange: (value: string) => void;
  }
>(({ className, value, onValueChange, ...props }, ref) => {
  return (
    <div data-slot="aui_thread-list-search" className="relative shrink-0 py-1">
      <SearchIcon
        data-slot="aui_thread-list-search-icon"
        className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
      />
      <Input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        aria-label="搜索课件标题"
        placeholder="搜索课件标题"
        className={cn("h-8 ps-8 text-sm", className)}
        {...props}
      />
    </div>
  );
});

ThreadListSearch.displayName = "ThreadListSearch";

export const ThreadListRoot = forwardRef<HTMLDivElement,
  ComponentPropsWithoutRef<typeof ThreadListPrimitive.Root>
>(({ className, ...props }, ref) => {
  return (
    <ThreadListPrimitive.Root
      ref={ref}
      data-slot="aui_thread-list-root"
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    />
  );
});
ThreadListRoot.displayName = 'ThreadListRoot';

export const ThreadListItems: FC<
  ComponentPropsWithoutRef<"div"> & { searchQuery?: string }
> = ({ className, searchQuery = "", ...props }) => {
  return (
    <div
      data-slot="aui_thread-list-items"
      className={cn("flex flex-col gap-0.5", className)}
      {...props}
    >
      <AuiIf condition={(s) => s.threads.isLoading}>
        <ThreadListSkeleton />
      </AuiIf>
      <AuiIf condition={(s) => !s.threads.isLoading}>
        <ThreadListItemGroups searchQuery={searchQuery} />
      </AuiIf>
    </div>
  );
};

const dateGroupLabel = (
  date: Date | undefined,
  startOfToday: number,
  startOfYesterday: number,
): string => {
  if (!date || date.getTime() >= startOfToday) return "今天";
  if (date.getTime() >= startOfYesterday) return "昨天";
  return "更早";
};

const startOfLocalDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const subscribeToNextDay = (onDayChange: () => void) => {
  let timeout: number;
  const scheduleNextDay = () => {
    const now = new Date();
    const startOfTomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).getTime();
    timeout = window.setTimeout(() => {
      onDayChange();
      scheduleNextDay();
    }, startOfTomorrow - now.getTime());
  };
  scheduleNextDay();
  return () => window.clearTimeout(timeout);
};

const getStartOfToday = () => startOfLocalDay(new Date());

// A server render and hydration see no day start, so a prerender never reads
// the clock; a client-only mount groups on its first render.
const getServerStartOfToday = () => undefined;

const useStartOfToday = () =>
  useSyncExternalStore<number | undefined>(
    subscribeToNextDay,
    getStartOfToday,
    getServerStartOfToday,
  );

export type ThreadListGroup = { label: string; indices: number[] };

/**
 * Filters the thread list by title and buckets the matches by last activity
 * (Today, Yesterday, Earlier). `groups` is null when no thread carries a date
 * or while the local day start is unknown during server render and hydration,
 * in which case `filteredIndices` keeps the runtime order.
 */
export const useThreadListGroups = (searchQuery = "") => {
  const { archived } = useContext(HostContext);
  const threadIds = useAuiState((s) => archived ? s.threads.archivedThreadIds : s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);

  const query = searchQuery.trim().toLowerCase();
  const startOfToday = useStartOfToday();

  return useMemo(() => {
    const itemsById = new Map(threadItems.map((item) => [item.id, item]));
    const dates = threadIds.map((id) => itemsById.get(id)?.lastMessageAt);
    const filteredIndices = threadIds
      .map((id, index) => ({ id, index }))
      .filter(
        ({ id }) =>
          !query ||
          (itemsById.get(id)?.title || "未命名课件")
            .toLowerCase()
            .includes(query),
      )
      .map(({ index }) => index);
    if (
      startOfToday === undefined ||
      !filteredIndices.some((index) => dates[index])
    ) {
      return { threadIds, filteredIndices, groups: null };
    }

    const yesterday = new Date(startOfToday);
    yesterday.setDate(yesterday.getDate() - 1);
    const startOfYesterday = yesterday.getTime();
    const time = (index: number) =>
      dates[index]?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const sorted = [...filteredIndices].sort((a, b) => time(b) - time(a));

    const result: ThreadListGroup[] = [];
    for (const index of sorted) {
      const label = dateGroupLabel(
        dates[index],
        startOfToday,
        startOfYesterday,
      );
      const lastGroup = result[result.length - 1];
      if (lastGroup?.label === label) {
        lastGroup.indices.push(index);
      } else {
        result.push({ label, indices: [index] });
      }
    }
    return { threadIds, filteredIndices, groups: result };
  }, [threadIds, threadItems, query, startOfToday]);
};

const ThreadListItemGroups: FC<{ searchQuery?: string }> = ({
  searchQuery = "",
}) => {
  const { threadIds, filteredIndices, groups } =
    useThreadListGroups(searchQuery);
  const query = searchQuery.trim();
  const isLoading = useAuiState(s => s.threads.isLoading);
  const items = useAuiState(s => s.threads.threadItems);
  const activeId = useAuiState(s => s.threads.mainThreadId);
  const titles = new Map(items.map(item => [item.id, item.title]));
  const { archived } = useContext(HostContext);

  if (query && filteredIndices.length === 0) {
    return (
      <div
        data-slot="aui_thread-list-empty"
        className="text-muted-foreground px-2.5 py-4 text-sm"
      >
        没有找到匹配的课件
      </div>
    );
  }

  if (!threadIds.length && !isLoading) return <div role="status" className="flex flex-col items-center px-3 py-8 text-center">
    {archived ? <ArchiveIcon aria-hidden className="mb-3 size-5 text-[var(--mm-text-stone-500)]" /> : <FolderOpenIcon aria-hidden className="mb-3 size-5 text-[var(--mm-text-stone-500)]" />}
    <p className="text-sm font-medium text-[var(--mm-text-stone-700)]">{archived ? '暂无归档课件' : '暂无课件'}</p>
    <p className="mt-1 text-xs leading-5 text-[var(--mm-text-stone-500)]">{archived ? '归档后的课件会保留在这里。' : '点击上方“新建课件”开始。'}</p>
  </div>;
  // One keyed presence group keeps rows mounted across date-group changes.
  const rows = groups ? groups.flatMap(group => [
    <div key={`heading-${group.label}`} data-slot="aui_thread-list-group-label" className="text-muted-foreground px-2.5 pt-3 pb-1 text-xs font-medium">{group.label}</div>,
    ...group.indices.map(index => <AnimatedThreadListItem key={threadIds[index]} index={index} archived={!!archived} title={titles.get(threadIds[index])} active={activeId === threadIds[index]} />),
  ]) : filteredIndices.map(index => <AnimatedThreadListItem key={threadIds[index]} index={index} archived={!!archived} title={titles.get(threadIds[index])} active={activeId === threadIds[index]} />);
  return <LayoutGroup><AnimatePresence initial={false} mode="popLayout">{rows}</AnimatePresence></LayoutGroup>;
};

// A removed row must release its index-based runtime scope immediately. The
// exit animation uses a static inert row, so deletion cannot retarget it
// to another courseware or read an index which no longer exists.
const AnimatedThreadListItem = forwardRef<HTMLDivElement, { index: number; archived: boolean; title?: string; active: boolean }>(({ index, archived, title, active }, ref) => {
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  return <motion.div ref={ref} layout={reducedMotion ? false : 'position'} initial={false}
    animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reducedMotion ? 0 : -8 }}
    transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.25, 1, 0.5, 1] }}
    className="relative shrink-0" aria-hidden={!present || undefined} inert={!present}>
    {present ? <ThreadListPrimitive.ItemByIndex index={index} archived={archived} components={itemComponents} />
      : <div className={cn('flex h-9 items-center rounded-lg px-2.5 text-sm', active && 'bg-[var(--mm-bg-emerald-50)] text-[var(--mm-text-emerald-900)]')}><span className="truncate">{title || '未命名课件'}</span></div>}
  </motion.div>;
});
AnimatedThreadListItem.displayName = 'AnimatedThreadListItem';

export const ThreadListNew = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Button> & { labelClassName?: string }
>(({ className, labelClassName, children, ...props }, ref) => {
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        ref={ref}
        variant="ghost"
        data-slot="aui_thread-list-new"
        className={cn(
          "hover:bg-muted data-active:bg-muted h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal",
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <PlusIcon
              data-slot="aui_thread-list-new-icon"
              className="size-4 shrink-0"
            />
            <span
              data-slot="aui_thread-list-new-label"
              className={cn("whitespace-nowrap", labelClassName)}
            >
              新建课件
            </span>
          </>
        )}
      </Button>
    </ThreadListPrimitive.New>
  );
});

ThreadListNew.displayName = "ThreadListNew";

const ThreadListSkeleton: FC = () => {
  return (
    <div
      role="status"
      aria-label="正在读取本地课件"
      className="thread-list-loading-placeholder flex flex-col gap-0.5"
    >
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          data-slot="aui_thread-list-skeleton-wrapper"
          className="flex h-8 items-center px-2.5"
        >
          <Skeleton
            data-slot="aui_thread-list-skeleton"
            className="h-3.5 w-full bg-[var(--mm-bg-stone-200)] motion-reduce:animate-none"
          />
        </div>
      ))}
    </div>
  );
};

export const ThreadListItem: FC = () => {
  const { disabled, selection, onOpen, onOpenCurrent } = useContext(HostContext);
  const id = useAuiState(s => s.threadListItem.id);
  const isCurrent = useAuiState(s => s.threadListItem.id === s.threads.mainThreadId);
  const isRunning = useAuiState((s) => s.threadListItem.isRunning);
  const [isRenaming, setIsRenaming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (isRenaming || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus();
  }, [isRenaming]);

  return (
    <ThreadListItemPrimitive.Root
      data-slot="aui_thread-list-item"
      data-selected={selection?.ids.has(id) || undefined}
      className="group hover:bg-muted focus-visible:bg-muted data-active:bg-[var(--mm-bg-emerald-50)] data-active:text-[var(--mm-text-emerald-900)] data-[selected=true]:bg-[var(--mm-bg-emerald-50)] has-focus-visible:bg-muted has-data-[state=open]:bg-muted relative flex h-9 items-center rounded-lg transition-colors focus-visible:outline-none motion-reduce:transition-none"
    >
      {isRenaming ? (
        <ThreadListItemRename
          onDone={(restoreFocus) => {
            restoreFocusRef.current = restoreFocus;
            setIsRenaming(false);
          }}
        />
      ) : (
        <ThreadListItemPrimitive.Trigger
          disabled={disabled}
          aria-pressed={selection?.enabled ? selection.ids.has(id) : undefined}
          onClick={event => {
            if (selection?.enabled) { event.preventDefault(); selection.onToggle(id); }
            else if (onOpen) { event.preventDefault(); onOpen(id); }
            else if (isCurrent) onOpenCurrent?.();
          }}
          ref={triggerRef}
          data-slot="aui_thread-list-item-trigger"
          className="focus-visible:ring-ring/50 flex h-full min-w-0 flex-1 items-center rounded-md px-2.5 text-start text-sm outline-none group-hover:pe-9 group-has-focus-visible:pe-9 group-has-data-[state=open]:pe-9 group-data-active:pe-9 focus-visible:ring-1"
        >
          {selection?.enabled && <span aria-hidden className={cn('me-2 flex size-4 shrink-0 items-center justify-center rounded border', selection.ids.has(id) ? 'border-[var(--mm-border-emerald-700)] bg-[var(--mm-bg-emerald-700)] text-white' : 'border-[var(--mm-border-stone-400)]')}>{selection.ids.has(id) && <CheckIcon className="size-3" />}</span>}
          {isRunning && (
            <Loader2Icon
              aria-hidden
              data-slot="aui_thread-list-item-running"
              className="text-muted-foreground me-1.5 size-3.5 shrink-0 animate-spin"
            />
          )}
          <span
            data-slot="aui_thread-list-item-title"
            className="min-w-0 flex-1 truncate"
          >
            <ThreadListItemPrimitive.Title fallback="未命名课件" />
          </span>
          {isRunning && <span className="sr-only">正在生成</span>}
        </ThreadListItemPrimitive.Trigger>
      )}
      {!selection?.enabled && !isRenaming && <ThreadListItemMore onRename={() => setIsRenaming(true)} />}
    </ThreadListItemPrimitive.Root>
  );
};
const itemComponents = { ThreadListItem };

const ThreadListItemRename: FC<{
  onDone: (restoreFocus: boolean) => void;
}> = ({ onDone }) => {
  const aui = useAui();
  const title = useAuiState((s) => s.threadListItem.title) ?? "";
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = (restoreFocus: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;

    const next = value.trim();
    if (!next || next === title) {
      onDone(restoreFocus);
      return;
    }

    // Deferred so a synchronous throw lands on the rejection path too.
    Promise.resolve()
      .then(() => aui.threadListItem.__internal_getRuntime?.()?.rename(next))
      .then(
        () => onDone(restoreFocus),
        () => {
          settledRef.current = false;
          if (restoreFocus) inputRef.current?.focus();
        },
      );
  };

  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onDone(true);
  };

  return (
    <Input
      ref={inputRef}
      autoFocus
      data-slot="aui_thread-list-item-rename"
      aria-label="课件名称"
      value={value}
      className="h-7 min-w-0 flex-1 ps-2.5 pe-9 text-sm"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => commit(false)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
          return;
        if (event.key === "Enter") {
          event.preventDefault();
          commit(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
};

const ThreadListItemMore: FC<{ onRename: () => void }> = ({ onRename }) => {
  const { disabled, onDelete, portalContainer } = useContext(HostContext);
  const id = useAuiState(s => s.threadListItem.id);
  const archived = useAuiState(s => s.threadListItem.status === 'archived');
  const renamingRef = useRef(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletePending = useRef(false);
  const confirmingRef = useRef(false);
  const interactedOutsideRef = useRef(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const confirmDelete = async () => {
    if (!onDelete || disabled || deletePending.current) return;
    deletePending.current = true;
    setDeleting(true); setDeleteError(null);
    try { await onDelete(id); setDeleteOpen(false); }
    catch (cause) { setDeleteError(cause instanceof Error ? cause.message : '删除失败，请重试'); }
    finally { deletePending.current = false; setDeleting(false); }
  };
  return (
    <ThreadListItemMorePrimitive.Root sharedFocusGroup>
      <PopoverPrimitive.Root open={deleteOpen} onOpenChange={open => { if (!deletePending.current) setDeleteOpen(open); }}>
      <PopoverPrimitive.Anchor asChild>
      <ThreadListItemMorePrimitive.Trigger asChild>
        <Button
          ref={moreRef}
          disabled={disabled}
          variant="ghost"
          size="icon"
          data-slot="aui_thread-list-item-more"
          className={cn(
            "hover:bg-[var(--mm-bg-stone-200)] focus-visible:bg-[var(--mm-bg-stone-200)] data-[state=open]:bg-[var(--mm-bg-stone-200)] group-data-active:hover:bg-[var(--mm-bg-emerald-100)] group-data-active:focus-visible:bg-[var(--mm-bg-emerald-100)] group-data-active:data-[state=open]:bg-[var(--mm-bg-emerald-100)] absolute end-1.5 top-1/2 size-6 -translate-y-1/2 rounded-full p-0 opacity-0 group-hover:opacity-100 group-has-focus-visible:opacity-100 group-data-active:opacity-100 data-[state=open]:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100",
            // Button's disabled opacity must not reveal every idle row.
            "disabled:opacity-0 group-hover:disabled:opacity-50 group-has-focus-visible:disabled:opacity-50 group-data-active:disabled:opacity-50 data-[state=open]:disabled:opacity-50 [@media(hover:none)]:disabled:opacity-50",
            deleteOpen && 'bg-[var(--mm-bg-stone-200)] group-data-active:bg-[var(--mm-bg-emerald-100)] opacity-100 disabled:opacity-50'
          )}
        >
          <MoreHorizontalIcon className="size-3.5" />
          <span className="sr-only">课件操作</span>
        </Button>
      </ThreadListItemMorePrimitive.Trigger>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal container={portalContainer}>
        <PopoverPrimitive.Content side="right" align="start" sideOffset={6} collisionPadding={8}
          collisionBoundary={portalContainer?.closest('[data-slot="settings-dialog"]') ?? undefined}
          data-slot="aui_thread-list-item-delete-confirmation"
          aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={deleting}
          className="z-50 w-60 max-w-[calc(100vw-16px)] rounded-xl border border-[var(--mm-border-stone-200)] bg-popover p-3 text-popover-foreground shadow-sm outline-none"
          onOpenAutoFocus={event => { event.preventDefault(); interactedOutsideRef.current = false; cancelRef.current?.focus(); }}
          onCloseAutoFocus={event => { event.preventDefault(); if (!interactedOutsideRef.current) moreRef.current?.focus(); }}
          onEscapeKeyDown={event => {
            event.stopPropagation();
            if (deletePending.current) event.preventDefault();
          }}
          onInteractOutside={event => {
            if (deletePending.current) event.preventDefault();
            else interactedOutsideRef.current = true;
          }}>
          <h3 id={titleId} className="text-sm font-semibold">删除这个课件？</h3>
          <p id={descriptionId} className="mt-1 text-xs leading-5 text-[var(--mm-text-stone-600)]">删除后无法恢复。</p>
          {deleteError && <p role="alert" className="mt-2 text-xs leading-5 text-[var(--mm-text-amber-900)]">{deleteError}</p>}
          <div className="mt-3 flex justify-end gap-1.5">
            <PopoverPrimitive.Close asChild><Button ref={cancelRef} variant="ghost" size="sm" disabled={deleting}>取消</Button></PopoverPrimitive.Close>
            <Button variant="destructive" size="sm" aria-label="确认删除" disabled={disabled || deleting} onClick={() => { void confirmDelete(); }}>{deleting ? '正在删除…' : '删除'}</Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      <ThreadListItemMorePrimitive.Content
        portalProps={{ container: portalContainer }}
        collisionBoundary={portalContainer?.closest('[data-slot="settings-dialog"]') ?? undefined}
        onEscapeKeyDown={event => {
          // Radix keeps the menu's dismissable layer during its exit animation.
          // Escape belongs to the newly focused inline editor in that interval.
          if ((event.target as HTMLElement)?.dataset.slot === 'aui_thread-list-item-rename') event.preventDefault();
        }}
        onCloseAutoFocus={event => {
          // The inline input already owns focus. Restoring it to the menu's
          // trigger would blur the input and commit before Enter or Escape.
          if (renamingRef.current) { event.preventDefault(); renamingRef.current = false; }
          // Wait for the menu's focus scope to unmount before opening another
          // floating surface; its exit animation must not steal popup focus.
          if (confirmingRef.current) { event.preventDefault(); confirmingRef.current = false; setDeleteOpen(true); }
        }}
        side="right"
        align="start"
        sideOffset={6}
        data-slot="aui_thread-list-item-more-content"
        className={dropdownMenuContentClassName}
      >
        <ThreadListItemMorePrimitive.Item
          data-slot="aui_thread-list-item-more-item"
          className="hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
          onSelect={() => { renamingRef.current = true; onRename(); }}
        >
          <PencilIcon className="size-4" />
          重命名
        </ThreadListItemMorePrimitive.Item>
        {archived ? <ThreadListItemPrimitive.Unarchive asChild>
          <ThreadListItemMorePrimitive.Item disabled={disabled} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none hover:bg-accent focus:bg-accent"><ArchiveRestoreIcon className="size-4" />取消归档</ThreadListItemMorePrimitive.Item>
        </ThreadListItemPrimitive.Unarchive> : <ThreadListItemPrimitive.Archive asChild>
          <ThreadListItemMorePrimitive.Item disabled={disabled} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none hover:bg-accent focus:bg-accent"><ArchiveIcon className="size-4" />归档</ThreadListItemMorePrimitive.Item>
        </ThreadListItemPrimitive.Archive>}
          <ThreadListItemMorePrimitive.Item
            disabled={disabled || !onDelete}
            onSelect={() => { confirmingRef.current = true; setDeleteError(null); }}
            data-slot="aui_thread-list-item-more-item"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
          >
            <TrashIcon className="size-4" />
            删除
          </ThreadListItemMorePrimitive.Item>
      </ThreadListItemMorePrimitive.Content>
    </ThreadListItemMorePrimitive.Root>
  );
};
