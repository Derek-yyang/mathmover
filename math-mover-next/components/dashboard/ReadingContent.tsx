'use client';

// Code header composition follows assistant-ui's MarkdownText (MIT).
// https://www.assistant-ui.com/elements/markdown-text
import { useState, type ComponentPropsWithoutRef } from 'react';
import type { Element } from 'hast';
import { Check, Copy, Maximize2, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useReadingCopy } from '@/hooks/useReadingCopy';
import { codePreview } from '@/lib/reading-content';

function CopyButton({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const { status, copy } = useReadingCopy();
  return <>
    <button type="button" className={`reading-icon-button ${className}`} onClick={() => void copy(text)}
      aria-label={status === 'copied' ? '已复制' : label} title={status === 'error' ? '复制失败，请重试' : status === 'copied' ? '已复制' : label}>
      {status === 'copied' ? <Check aria-hidden size={15} /> : <Copy aria-hidden size={15} />}
      {status === 'error' && <span>复制失败</span>}
    </button>
    <span className="sr-only" role="status">{status === 'copied' ? '复制成功' : status === 'error' ? '复制失败，请重试或手动选取' : ''}</span>
  </>;
}

export function ChatCodeBlock({ code, language, copyLabel = '复制代码' }: { code: string; language?: string; copyLabel?: string }) {
  const [open, setOpen] = useState(false);
  const preview = codePreview(code);
  const pre = (text: string) => <pre><code>{text}</code></pre>;
  return <Collapsible open={open} onOpenChange={setOpen} className="chat-code-block" data-code-block>
    <div className="chat-code-header"><span>{language || '代码'}</span><CopyButton text={code} label={copyLabel} /></div>
    {preview.long ? <>
      {!open && pre(preview.preview)}
      <CollapsibleContent>{pre(code)}</CollapsibleContent>
      <CollapsibleTrigger className="reading-text-button code-expand"><ChevronDown aria-hidden size={14} className={open ? 'rotate-180' : ''} />{open ? '收起代码' : `展开全部 · ${preview.lines} 行`}</CollapsibleTrigger>
    </> : pre(code)}
  </Collapsible>;
}

export function ReadingTable({ children, node: _node, ...props }: ComponentPropsWithoutRef<'table'> & { node?: Element }) {
  void _node;
  const table = <table {...props}>{children}</table>;
  return <div className="reading-block chat-reading-table">
    <Dialog>
      <div className="reading-block-actions"><DialogTrigger asChild><button type="button" className="reading-icon-button" aria-label="放大查看表格" title="放大查看表格"><Maximize2 aria-hidden size={15} /></button></DialogTrigger></div>
      <div className="chat-table-scroll">{table}</div>
      <DialogContent>
        <DialogTitle className="reading-dialog-title">表格</DialogTitle>
        <DialogDescription className="sr-only">表格可在预览区域内横向滚动。</DialogDescription>
        <div className="chat-markdown reading-expanded-table">{table}</div>
      </DialogContent>
    </Dialog>
  </div>;
}

export function ReadingSpan({ node, className, children, ...props }: ComponentPropsWithoutRef<'span'> & { node?: Element }) {
  const source = node?.properties['data-math-source'];
  if (typeof source !== 'string') return <span className={className} {...props}>{children}</span>;
  const block = className?.split(' ').includes('katex-display');
  const formula = <span className={className} {...props}>{children}</span>;
  if (!block) return <span className="chat-math-inline">
    {formula}<span className="math-inline-action"><CopyButton text={source} label="复制公式 LaTeX" /></span>
  </span>;
  return <span className="reading-block chat-reading-formula">
    <Dialog>
      <span className="reading-block-actions"><CopyButton text={source} label="复制公式 LaTeX" />
        <DialogTrigger asChild><button type="button" className="reading-icon-button" aria-label="放大查看公式" title="放大查看公式"><Maximize2 aria-hidden size={15} /></button></DialogTrigger>
      </span>
      <span className="chat-formula-scroll">{formula}</span>
      <DialogContent>
        <DialogTitle className="reading-dialog-title">公式</DialogTitle>
        <DialogDescription className="sr-only">放大显示数学公式，可横向滚动或复制原始 LaTeX。</DialogDescription>
        <div className="chat-markdown reading-expanded-formula">{formula}</div>
        <div className="reading-dialog-footer"><CopyButton text={source} label="复制公式 LaTeX" /></div>
      </DialogContent>
    </Dialog>
  </span>;
}
