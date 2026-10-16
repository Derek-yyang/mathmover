// Upstream registry source; see ../UPSTREAM.md for provenance.
"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/components/assistant-ui/utils";
import {
  CollapsibleRoot as Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible-root";
import { collapsePanel } from "./surfaces";
import { ThinkingIndicator } from "./thinking-indicator";

const summaryRow = "text-muted-foreground flex min-w-0 max-w-full items-center gap-1.5 py-1 text-sm";

export type RunActivityStatus =
  | "running"
  | "requires-action"
  | "complete"
  | "cancelled"
  | "incomplete"
  | "error";

export type RunActivityEntry = {
  id: string;
  kind: "commentary" | "tool";
  label: string;
  content: ReactNode;
};

export type RunActivityProps = {
  status: RunActivityStatus;
  statusLabel: string;
  /** Host-observed current state overrides the latest historical entry. */
  currentActivityLabel?: string;
  /** Formatted from the caller's persisted run timing. */
  durationLabel?: ReactNode;
  entries: readonly RunActivityEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pending decisions and recovery controls remain outside the disclosure. */
  attention?: ReactNode;
  /** Final-answer content remains outside the disclosure. */
  children?: ReactNode;
  className?: string;
};

export function RunActivity({
  status,
  statusLabel,
  currentActivityLabel,
  durationLabel,
  entries,
  open,
  onOpenChange,
  attention,
  children,
  className,
}: RunActivityProps) {
  const latestActivity =
    status === "running"
      ? entries.findLast((entry) => entry.label.trim())?.label
      : undefined;
  const summaryLabel = status === "running" && !open
    ? currentActivityLabel?.trim() || latestActivity || statusLabel
    : statusLabel;

  const summary = status === "running" ? (
    <ThinkingIndicator label={summaryLabel} elapsed={durationLabel} className="gap-1.5" />
  ) : (
    <span className="flex min-w-0 items-center gap-1 text-start tabular-nums">
      <span data-slot="run-activity-label" className="truncate" title={summaryLabel}>{summaryLabel}</span>
      {durationLabel != null && <span className="shrink-0 whitespace-nowrap">{durationLabel}</span>}
    </span>
  );

  return (
    <div
      data-slot="run-activity"
      data-status={status}
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      {entries.length > 0 ? (
        <Collapsible open={open} onOpenChange={onOpenChange}>
          <CollapsibleTrigger
            aria-busy={status === "running"}
            className={cn(summaryRow, "group/trigger hover:text-foreground focus-visible:ring-ring/50 rounded-md outline-none focus-visible:ring-[3px]")}
          >
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform duration-200 group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90 group-data-[state=open]/trigger:rotate-90 motion-reduce:transition-none"
            />
            {summary}
          </CollapsibleTrigger>
          <CollapsibleContent className={collapsePanel}>
            <ol className="border-border ms-1.5 flex min-w-0 flex-col gap-3 border-s ps-3.5 pt-2 text-sm wrap-anywhere">
              {entries.map((entry) => (
                <li key={entry.id} data-activity-kind={entry.kind}>
                  {entry.content}
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <div className={summaryRow}>
          <span aria-hidden="true" className="size-3.5 shrink-0" />
          {summary}
        </div>
      )}
      {/* Announce the settled duration without announcing streaming timer ticks. */}
      <span role="status" aria-atomic="true" className="sr-only">
        {statusLabel}
        {status !== "running" && durationLabel != null && <> {durationLabel}</>}
      </span>
      {attention}
      {children}
    </div>
  );
}
