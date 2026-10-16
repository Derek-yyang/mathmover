'use client';

import { useEffect, useState } from 'react';
import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { SyntaxHighlighter } from '@/components/assistant-ui/elements/shiki-highlighter';
import { CodePre } from '@/components/assistant-ui/elements/code-block';
import { ggbLanguage, ggbLightTheme, ggbDarkTheme } from '@/lib/ggb-highlight';

let highlighterPromise: Promise<HighlighterCore> | undefined;
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      engine: createJavaScriptRegexEngine(),
      langs: [ggbLanguage], themes: [ggbLightTheme, ggbDarkTheme],
    }).catch(error => { highlighterPromise = undefined; throw error; });
  }
  return highlighterPromise;
}

const themes = { light: ggbLightTheme.name!, dark: ggbDarkTheme.name! };
const transformers = [{
  name: 'mathmover:accessible-code',
  pre(node: { properties: Record<string, unknown> }) {
    node.properties.tabIndex = 0;
    node.properties['aria-label'] = 'GeoGebra 代码';
  },
}];

export default function GgbCodeHighlight({ code }: { code: string }) {
  const [highlighter, setHighlighter] = useState<HighlighterCore>();
  useEffect(() => {
    let active = true;
    getHighlighter().then(value => { if (active) setHighlighter(value); }, () => {});
    return () => { active = false; };
  }, []);

  if (!highlighter) return <CodePre tabIndex={0} aria-label="GeoGebra 代码"><code>{code}</code></CodePre>;
  return <SyntaxHighlighter code={code} language="geogebra" highlighter={highlighter}
    theme={themes} transformers={transformers} delay={0}
    style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}
    className="mm-ggb-highlight [&_pre]:min-w-0 [&_pre]:max-w-full [&_pre]:overscroll-x-contain [&_pre:focus-visible]:outline-2 [&_pre:focus-visible]:-outline-offset-2 [&_pre:focus-visible]:outline-ring" />;
}
