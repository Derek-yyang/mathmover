// Extracted from the official Markdown renderer; see ../UPSTREAM.md.
"use client";

import { lazy, Suspense, type ComponentProps } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { TooltipIconButton } from "./tooltip-icon-button";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";
import { cn } from "../utils";

const GgbCodeHighlight = lazy(() => import("@/components/dashboard/GgbCodeHighlight")
  .catch(() => ({ default: PlainGgbCode })));

function PlainGgbCode({ code }: { code: string }) {
  return <CodePre tabIndex={0} aria-label="GeoGebra 代码"><code className="font-mono">{code}</code></CodePre>;
}

export function CodeHeader({ language = "text", code, className }: {
  language?: string;
  code: string;
  className?: string;
}) {
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  return (
    <div className={cn("aui-code-header-root border-border/50 bg-muted/50 mt-3 flex items-center justify-between rounded-t-xl border border-b-0 px-3.5 py-1.5 text-xs", className)}>
      <span className="aui-code-header-language text-muted-foreground font-medium">
        {language}
      </span>
      <TooltipIconButton tooltip={isCopied ? "已复制" : "复制代码"} onClick={() => {
        if (code && !isCopied) copyToClipboard(code);
      }}>
        {isCopied
          ? <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out motion-reduce:animate-none" />
          : <CopyIcon className="animate-in zoom-in-75 fade-in duration-150 motion-reduce:animate-none" />}
      </TooltipIconButton>
    </div>
  );
}

export function CodePre({ className, ...props }: ComponentProps<"pre">) {
  return <pre className={cn(
    "aui-md-pre border-border/50 bg-muted/30 min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-t-none rounded-b-xl border border-t-0 p-3.5 text-[13px] leading-relaxed",
    className,
  )} {...props} />;
}

/** The Markdown code-block surface, usable without parsing generated Markdown. */
export function CodeBlock({ language, code }: { language: string; code: string }) {
  const plain = <CodePre tabIndex={0} aria-label={`${language} 代码`} className="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
    <code className="font-mono">{code}</code>
  </CodePre>;
  return <div data-slot="code-block" className="min-w-0 max-w-full">
    <CodeHeader language={language} code={code} className="mt-0" />
    {language.toLowerCase() === 'geogebra'
      ? <Suspense fallback={plain}><GgbCodeHighlight code={code} /></Suspense>
      : plain}
  </div>;
}
