// Upstream registry source; see ../UPSTREAM.md for provenance.
"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/components/assistant-ui/utils";
import { mono, ShimmerLabel } from "./surfaces";

export function ThinkingIndicator({
  label,
  elapsed,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children" | "label" | "elapsed"> & {
  label: string;
  elapsed?: ReactNode;
}) {
  return (
    <span
      data-slot="thinking-indicator"
      className={cn(
        "text-muted-foreground inline-flex min-w-0 max-w-full items-center gap-2.5 text-sm",
        className,
      )}

      {...props}
    >
      <span
        aria-hidden
        data-slot="thinking-indicator-dot"
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
      />
      <ShimmerLabel
        key={label}
        data-slot="thinking-indicator-label"
        title={label}
        className="fade-in slide-in-from-bottom-1 animate-in relative inline-block min-w-0 truncate leading-5 duration-200 motion-reduce:animate-none"
      >
        {label}
      </ShimmerLabel>
      {elapsed != null && (
        <span
          className={cn(mono, "text-muted-foreground shrink-0 whitespace-nowrap tabular-nums")}
        >
          {elapsed}
        </span>
      )}
    </span>
  );
}
