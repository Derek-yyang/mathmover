'use client';

import { useState } from 'react';
import { ChevronDown, Download, FileCode2, Globe, ImageIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../assistant-ui/ui/dropdown-menu';
import type { CoursewareExportFormat } from './types';

const formats = [
  { type: 'html', label: '导出 HTML 课件', description: '浏览器交互网页', icon: Globe },
  { type: 'ggb', label: '导出 .GGB 课件', description: 'GeoGebra 源文件', icon: FileCode2 },
  { type: 'png', label: '导出 PNG 截图', description: '高清画板图片', icon: ImageIcon },
] as const;

export default function CoursewareExportMenu({ onExport, disabled = false }: { onExport: (type: CoursewareExportFormat) => void; disabled?: boolean }) {
  const [portalContainer, setPortalContainer] = useState<Element | null>(null);
  return <DropdownMenu modal={false} onOpenChange={open => {
    // Browser fullscreen only displays descendants of its fullscreen element.
    if (open) setPortalContainer(document.fullscreenElement);
  }}>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label="导出" title="导出课件" disabled={disabled}
        className="group ml-1 flex shrink-0 items-center gap-1 rounded-lg bg-[var(--mm-bg-emerald-600)] px-2.5 py-1.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[var(--mm-bg-emerald-700)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)] motion-reduce:transition-none disabled:opacity-40 disabled:cursor-not-allowed @max-[320px]:ml-0 @max-[320px]:p-2">
        <Download aria-hidden className="h-3.5 w-3.5" /><span className="@max-[320px]:hidden">导出</span>
        <ChevronDown aria-hidden className="h-3 w-3 opacity-80 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none @max-[320px]:hidden" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" loop portalContainer={portalContainer}
      // Dismiss the menu without also leaving the presentation fallback.
      onEscapeKeyDown={event => event.stopPropagation()}
      className="w-48 max-w-[calc(100vw-16px)]">
      {formats.map(({ type, label, description, icon: Icon }) => <DropdownMenuItem key={type} disabled={disabled} textValue={label} onSelect={() => { if (!disabled) onExport(type); }}>
        <Icon aria-hidden className="h-4 w-4 shrink-0 text-[var(--mm-text-emerald-700)]" />
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs leading-5 text-[var(--mm-text-stone-600)]">{description}</div>
        </div>
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
