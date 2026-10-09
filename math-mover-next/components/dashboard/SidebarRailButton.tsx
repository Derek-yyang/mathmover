'use client';

import { useId, useState, type ReactNode } from 'react';

interface RailButtonProps {
  label: string;
  children: ReactNode;
  onClick: () => void;
  id?: string;
  controls?: string;
  expanded?: boolean;
}

export default function SidebarRailButton({ label, children, onClick, id, controls, expanded }: RailButtonProps) {
  const tooltipId = useId();
  const [dismissed, setDismissed] = useState(false);

  return (
    <button type="button" id={id} onClick={onClick} aria-label={label} aria-describedby={tooltipId}
      aria-controls={controls} aria-expanded={expanded}
      onPointerEnter={() => setDismissed(false)} onFocus={() => setDismissed(false)}
      onKeyDown={event => { if (event.key === 'Escape') setDismissed(true); }}
      className="group relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-stone-700 hover:bg-stone-200/60 focus-visible:outline-2 focus-visible:outline-emerald-700">
      <span aria-hidden="true" className="flex items-center justify-center">{children}</span>
      <span id={tooltipId} role="tooltip"
        className={`pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white ${dismissed ? 'invisible' : 'invisible group-hover:visible group-focus-visible:visible'}`}>
        {label}
      </span>
    </button>
  );
}
