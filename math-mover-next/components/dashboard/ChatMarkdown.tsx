'use client';

import { memo } from 'react';
import { MarkdownTextPrimitive, normalizeMathDelimiters } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];
const components = {
  a: ({ children, href }: React.ComponentPropsWithoutRef<'a'>) =>
    <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  // Agent Markdown must not automatically fetch remote image URLs.
  img: ({ alt }: React.ComponentPropsWithoutRef<'img'>) => <span>[图片：{alt || '未加载'}]</span>,
  table: ({ children }: React.ComponentPropsWithoutRef<'table'>) =>
    <div className="chat-table-scroll"><table>{children}</table></div>,
};

export default memo(function ChatMarkdown() {
  return <MarkdownTextPrimitive className="chat-markdown" remarkPlugins={remarkPlugins}
    rehypePlugins={rehypePlugins} preprocess={normalizeMathDelimiters} components={components}
    smooth={false} defer skipHtml />;
});
