import type { Element, Root } from 'hast';

export function codePreview(code: string) {
  const newline = String.fromCharCode(10);
  const rows = (code.endsWith(newline) ? code.slice(0, -1) : code).split(newline);
  return { lines: rows.length, long: rows.length > 12 || code.length > 2000,
    preview: Array.from(rows.slice(0, 12).join(newline)).slice(0, 2000).join('') };
}

function latexSource(node: Element): string | undefined {
  if (node.tagName === 'annotation' && node.properties.encoding === 'application/x-tex') {
    return node.children.filter(child => child.type === 'text').map(child => child.value).join('');
  }
  for (const child of node.children) {
    if (child.type !== 'element') continue;
    const source = latexSource(child);
    if (source !== undefined) return source;
  }
}

/** Annotate only the outer KaTeX node, so display math gets one set of controls. */
export function rehypeMathSource() {
  return (tree: Root) => {
    const walk = (parent: Root | Element) => {
      for (const child of parent.children) {
        if (child.type !== 'element') continue;
        const classes = child.properties.className;
        if (Array.isArray(classes) && (classes.includes('katex-display') || classes.includes('katex'))) {
          const source = latexSource(child);
          if (source !== undefined) child.properties['data-math-source'] = source;
        } else walk(child);
      }
    };
    walk(tree);
  };
}
