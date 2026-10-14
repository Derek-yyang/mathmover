'use client';

import {
  Grid,
  Settings2,
  Maximize2,
  Minimize2,
  RotateCcw,
} from 'lucide-react';
import type { CoursewareExportFormat } from './types';
import CoursewareExportMenu from './CoursewareExportMenu';
import CoursewareTitle from './CoursewareTitle';
import BoardConnectionStatus from './BoardConnectionStatus';
import type { GgbConnectionStatus } from '@/lib/ggb-connection';

interface ControlDeckProps {
  title: string;
  editorId?: string;
  onRename?: (title: string) => Promise<void>;
  renameDisabled?: boolean;
  boardDisabled?: boolean;
  saveStatusText?: string;
  connectionStatus?: GgbConnectionStatus;
  onReconnect?: () => void;
  showAxes: boolean;
  axesMixed?: boolean;
  showGrid: boolean;
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
  isFullscreen: boolean;
  onToggleAxes: () => void;
  onToggleGrid: () => void;
  onResetView: () => void;
  onToggleFullscreen: () => void;
  onExport?: (type: CoursewareExportFormat) => void;
}

export default function ControlDeck({
  title,
  editorId,
  onRename,
  renameDisabled,
  boardDisabled = false,
  saveStatusText,
  connectionStatus,
  onReconnect,
  showAxes,
  axesMixed = false,
  showGrid,
  settingsOpen = false,
  onToggleSettings,
  isFullscreen,
  onToggleAxes,
  onToggleGrid,
  onResetView,
  onToggleFullscreen,
  onExport,
}: ControlDeckProps) {
  return (
    <div className="@container relative z-10 shrink-0">
    <header data-slot="board-toolbar" className="grid select-none grid-cols-[minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b border-[#E7E5E4] bg-[#FDFCF8] px-4 py-2 @min-[560px]:grid-cols-[minmax(0,1fr)_auto]">
      {/* 左侧：课件标题 */}
      <div data-slot="board-toolbar-title" className="order-1 flex min-w-0 items-center gap-3 @min-[560px]:min-h-10">
        <div className="flex min-w-0 items-center gap-2 has-[[data-slot=courseware-title-editor]]:[&_[role=status]]:hidden">
          {onRename ? <CoursewareTitle key={editorId} title={title} onRename={onRename} disabled={renameDisabled} />
            : <span className="max-w-[200px] truncate text-sm font-semibold text-stone-800" title={title}>{title || '未命名课件'}</span>}
          {saveStatusText && <span role="status" aria-label="课件保存状态" className="hidden shrink-0 text-xs text-stone-600 @min-[560px]:inline">{saveStatusText}</span>}
        </div>
        {connectionStatus && <BoardConnectionStatus status={connectionStatus} onReconnect={onReconnect} />}
      </div>

      {/* 右侧：视图控制、导出与操作按钮 */}
      <div data-slot="board-toolbar-actions" className="order-2 flex min-w-0 flex-wrap items-center gap-1 [&>button]:shrink-0 @min-[560px]:justify-end">
        <button
          type="button"
          onClick={onToggleAxes}
          disabled={boardDisabled}
          title={axesMixed ? '坐标轴部分显示，点击显示全部' : showAxes ? '隐藏坐标轴' : '显示坐标轴'}
          aria-label="显示坐标轴"
          aria-pressed={axesMixed ? 'mixed' : showAxes}
          className={`p-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            axesMixed ? 'text-emerald-700 bg-stone-100 ring-1 ring-inset ring-emerald-600/40 hover:bg-emerald-50' : showAxes
              ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
              : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
          }`}
        >
          <span className="text-[11px] font-mono font-bold leading-none">XY</span>
        </button>

        <button
          type="button"
          onClick={onToggleGrid}
          disabled={boardDisabled}
          title={showGrid ? '隐藏网格' : '显示网格'}
          aria-label="显示网格"
          aria-pressed={showGrid}
          className={`p-2 rounded-lg text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            showGrid
              ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
              : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
          }`}
        >
          <Grid className="w-4 h-4" />
        </button>

        <button type="button" onClick={onToggleSettings} disabled={boardDisabled || !onToggleSettings}
          aria-label="画板设置" title={settingsOpen ? '关闭画板设置' : '打开画板设置'} aria-pressed={settingsOpen}
          className={`p-2 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-40 ${settingsOpen ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100' : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'}`}>
          <Settings2 aria-hidden className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onResetView}
          disabled={boardDisabled}
          title="重置视图居中"
          aria-label="重置视图居中"
          className="p-2 rounded-lg text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* 导出下拉按钮 */}
        {onExport && <CoursewareExportMenu onExport={onExport} disabled={boardDisabled} />}

        <div className="w-[1px] h-4 bg-stone-200 mx-1" />

        <button
          type="button"
          onClick={onToggleFullscreen}
          title={isFullscreen ? '退出全屏' : '全屏演示'}
          aria-label={isFullscreen ? '退出全屏' : '全屏演示'}
          aria-pressed={isFullscreen}
          className="p-2 rounded-lg text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

    </header>
    </div>
  );
}
