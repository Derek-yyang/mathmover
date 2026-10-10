'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Grid,
  Maximize2,
  Minimize2,
  RotateCcw,
  ChevronDown,
  Download,
  FileCode2,
  Globe,
  Image as ImageIcon
} from 'lucide-react';
import { CoursewareExportFormat, SliderItem } from './types';

interface ControlDeckProps {
  title: string;
  saveStatusText?: string;
  sliders: SliderItem[];
  showAxes: boolean;
  showGrid: boolean;
  isFullscreen: boolean;
  onSliderChange: (name: string, value: number) => void;
  onToggleAnimation: (name: string) => void;
  onToggleAxes: () => void;
  onToggleGrid: () => void;
  onResetView: () => void;
  onToggleFullscreen: () => void;
  onExport?: (type: CoursewareExportFormat) => void;
}

export default function ControlDeck({
  title,
  saveStatusText,
  sliders,
  showAxes,
  showGrid,
  isFullscreen,
  onSliderChange,
  onToggleAnimation,
  onToggleAxes,
  onToggleGrid,
  onResetView,
  onToggleFullscreen,
  onExport,
}: ControlDeckProps) {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // 普通页面区域通过 mousedown 关闭；GeoGebra 嵌入区可能是 iframe，
  // 内部点击不会冒泡到页面，用 focusin 捕捉焦点转入 iframe 的情况。
  useEffect(() => {
    const closeWhenOutside = (target: EventTarget | null) => {
      if (exportMenuRef.current && target instanceof Node && !exportMenuRef.current.contains(target)) {
        setShowExportMenu(false);
      }
    };
    const handleMouseDown = (event: MouseEvent) => closeWhenOutside(event.target);
    const handleFocusIn = (event: FocusEvent) => closeWhenOutside(event.target);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('focusin', handleFocusIn);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('focusin', handleFocusIn);
    };
  }, []);

  return (
    <header className="relative z-10 flex h-14 shrink-0 select-none items-center justify-between gap-3 border-b border-[#E7E5E4] bg-[#FDFCF8] px-4">
      {/* 左侧：课件标题 */}
      <div className={`flex min-w-0 items-center gap-3 ${sliders.length === 0 ? 'flex-1' : ''}`}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold text-stone-800 text-sm truncate max-w-[200px]" title={title}>
            {title || '未命名课件'}
          </span>
          {saveStatusText && <span role="status" aria-label="课件保存状态" className="hidden shrink-0 text-xs text-stone-600 sm:inline">{saveStatusText}</span>}
        </div>
      </div>

      {/* 中间：参数与动点控制区 (Sliders Deck) */}
      {sliders.length > 0 && (
        <div className="flex min-w-0 flex-1 items-center justify-center gap-4 overflow-x-auto py-1 px-2" role="group" aria-label="课件参数">
          <div className="flex items-center gap-3">
            {sliders.map((s) => (
              <div
                key={s.name}
                className="flex items-center gap-2 bg-[#F5F5F0] hover:bg-stone-200/60 border border-stone-200/80 rounded-lg px-2.5 py-1 text-xs transition-colors shrink-0"
              >
                <button
                  type="button"
                  onClick={() => onToggleAnimation(s.name)}
                  title={s.isAnimating ? '暂停动画' : '播放动画演示'}
                  className={`p-1 rounded-md transition-colors ${
                    s.isAnimating
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'text-stone-600 hover:text-emerald-600 hover:bg-white'
                  }`}
                >
                  {s.isAnimating ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>

                <span className="font-mono font-medium text-stone-700 min-w-[24px]">
                  {s.name}
                </span>

                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step || 0.1}
                  value={s.value}
                  aria-label={`参数 ${s.name}`}
                  onChange={(e) => onSliderChange(s.name, parseFloat(e.target.value))}
                  className="w-24 h-1.5 bg-stone-300 rounded-lg appearance-none cursor-pointer accent-emerald-600 focus:outline-none"
                />

                <span className="font-mono text-stone-600 w-10 text-right tabular-nums">
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 右侧：视图控制、导出与操作按钮 */}
      <div className="flex items-center gap-1 shrink-0 pl-2">
        <button
          type="button"
          onClick={onToggleAxes}
          title={showAxes ? '隐藏坐标轴' : '显示坐标轴'}
          aria-pressed={showAxes}
          className={`p-2 rounded-lg text-xs font-medium transition-colors ${
            showAxes
              ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
              : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
          }`}
        >
          <span className="text-[11px] font-mono font-bold leading-none">XY</span>
        </button>

        <button
          type="button"
          onClick={onToggleGrid}
          title={showGrid ? '隐藏网格' : '显示网格'}
          aria-pressed={showGrid}
          className={`p-2 rounded-lg text-xs transition-colors ${
            showGrid
              ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
              : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100'
          }`}
        >
          <Grid className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onResetView}
          title="重置视图居中"
          className="p-2 rounded-lg text-stone-500 hover:text-stone-800 hover:bg-stone-100 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* 导出下拉按钮 */}
        {onExport && (
          <div className="relative" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setShowExportMenu((prev) => !prev)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-xs ml-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出</span>
              <ChevronDown className="w-3 h-3 opacity-80" />
            </button>

            {showExportMenu && (
              <div className="absolute right-0 mt-1.5 w-40 bg-white border border-[#E7E5E4] rounded-xl shadow-lg p-1 z-50 text-xs select-none">
                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    onExport('html');
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-stone-100 text-stone-700 text-left transition-colors"
                >
                  <Globe className="w-4 h-4 text-emerald-600" />
                  <div>
                    <div className="font-medium">导出 HTML 课件</div>
                    <div className="text-[10px] text-stone-600">浏览器交互网页</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    onExport('ggb');
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-stone-100 text-stone-700 text-left transition-colors"
                >
                  <FileCode2 className="w-4 h-4 text-emerald-600" />
                  <div>
                    <div className="font-medium">导出 .GGB 课件</div>
                    <div className="text-[10px] text-stone-400">GeoGebra 源文件</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    onExport('png');
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-stone-100 text-stone-700 text-left transition-colors"
                >
                  <ImageIcon className="w-4 h-4 text-emerald-600" />
                  <div>
                    <div className="font-medium">导出 PNG 截图</div>
                    <div className="text-[10px] text-stone-400">高清画板图片</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        )}

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
  );
}
