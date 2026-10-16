import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const source = readFileSync(new URL('../lib/ggb-highlight.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText;
const { ggbLanguage, ggbLightTheme, ggbDarkTheme } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const highlighter = await createHighlighterCore({ engine: createJavaScriptRegexEngine(),
  langs: [ggbLanguage], themes: [ggbLightTheme, ggbDarkTheme] });
const tokens = (code, theme = ggbLightTheme.name) => highlighter.codeToTokens(code, {
  lang: 'geogebra', theme, includeExplanation: true,
}).tokens;
const scoped = (lines, scope) => lines.flat().filter(token => token.explanation?.some(part => part.scopes.some(s => s.scopeName.startsWith(scope)))).map(t => t.content).join('');

test('calls, nested functions, boolean values and scientific numbers are distinct', () => {
  const code = 'ShowGrid(1, true)\nA1 = Ellipse[O, P, sqrt(3^2 - .75)]\na = -1.25e-3 + 2E+4';
  const lines = tokens(code);
  assert.equal(lines.map(line => line.map(t => t.content).join('')).join('\n'), code);
  assert.equal(scoped(lines, 'entity.name.function'), 'ShowGridEllipsesqrt');
  assert.equal(scoped(lines, 'constant.language.boolean'), 'true');
  assert.equal(scoped(lines, 'constant.numeric'), '132.751.25e-32E+4');
  assert(!scoped(lines, 'constant.numeric').includes('A1'));
});

test('Chinese calls, quotes, URLs and HTML-like string content stay literal', () => {
  const code = String.raw`文本("中文 \" <b> & https://example.com/3 true", (0,0))`;
  const lines = tokens(code);
  assert.equal(scoped(lines, 'entity.name.function'), '文本');
  assert.equal(scoped(lines, 'comment'), '');
  assert.equal(scoped(lines, 'constant.language.boolean'), '');
  assert(scoped(lines, 'string').includes('https://example.com/3 true'));
  assert.equal(lines.map(line => line.map(t => t.content).join('')).join('\n'), code);
});

test('comments and unfinished strings do not leak into the next command', () => {
  const lines = tokens('Text("unfinished\nA = 2 // true 100\nB = false');
  assert.equal(scoped(lines, 'comment'), '// true 100');
  assert.equal(scoped(lines, 'constant.numeric'), '2');
  assert.equal(scoped(lines, 'constant.language.boolean'), 'false');
});

test('both palettes color tokens while preserving whitespace and source', () => {
  const code = '\n  Text("中文", (0, -3))\n\n';
  for (const theme of [ggbLightTheme.name, ggbDarkTheme.name]) {
    const lines = tokens(code, theme);
    assert.equal(lines.map(line => line.map(t => t.content).join('')).join('\n'), code);
    assert(new Set(lines.flat().map(t => t.color)).size >= 4);
  }
  assert.notEqual(tokens('Ellipse(3)')[0][0].color, tokens('Ellipse(3)', ggbDarkTheme.name)[0][0].color);
});
