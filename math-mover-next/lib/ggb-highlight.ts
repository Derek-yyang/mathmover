import type { LanguageRegistration, ThemeRegistration } from 'shiki/core';

/** Lexical display rules, not a command catalog or construction validator. */
export const ggbLanguage: LanguageRegistration = {
  name: 'geogebra',
  displayName: 'GeoGebra',
  scopeName: 'source.geogebra',
  aliases: ['ggb'],
  repository: {},
  patterns: [
    { name: 'comment.line.double-slash.geogebra', match: '//.*$' },
    {
      name: 'string.quoted.double.geogebra', begin: '"', end: '"|$',
      patterns: [{ name: 'constant.character.escape.geogebra', match: '\\\\.' }],
    },
    { name: 'constant.language.boolean.geogebra', match: '(?<![\\p{L}\\p{N}_])(?:true|false)(?![\\p{L}\\p{N}_])' },
    { name: 'entity.name.function.geogebra', match: '[\\p{L}_][\\p{L}\\p{N}_]*(?=\\s*(?:\\(|\\[))' },
    { name: 'constant.numeric.geogebra', match: '(?<![\\p{L}\\p{N}_.])(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?(?![\\p{L}\\p{N}_])' },
    { name: 'keyword.operator.geogebra', match: '[:=+*/^<>!−×÷≤≥≠∧∨¬-]+' },
    { name: 'punctuation.geogebra', match: '[()\\[\\]{},;]' },
  ],
};

function theme(name: string, type: 'light' | 'dark', colors: string[]): ThemeRegistration {
  const [foreground, call, number, string, boolean, operator, punctuation, comment] = colors;
  return {
    name, type,
    colors: { 'editor.foreground': foreground, 'editor.background': type === 'light' ? '#faf9f7' : '#202020' },
    tokenColors: [
      { scope: 'entity.name.function', settings: { foreground: call } },
      { scope: 'constant.numeric', settings: { foreground: number } },
      { scope: ['string', 'constant.character.escape'], settings: { foreground: string } },
      { scope: 'constant.language.boolean', settings: { foreground: boolean } },
      { scope: 'keyword.operator', settings: { foreground: operator } },
      { scope: 'punctuation', settings: { foreground: punctuation } },
      { scope: 'comment', settings: { foreground: comment } },
    ],
  };
}

export const ggbLightTheme = theme('mathmover-code-light', 'light',
  ['#292524', '#006f59', '#7750b0', '#96501c', '#9a3876', '#57534e', '#716b65', '#716b65']);
export const ggbDarkTheme = theme('mathmover-code-dark', 'dark',
  ['#eeeeee', '#75dbc1', '#cfb5ff', '#efbb8c', '#f5acd1', '#c6c6c6', '#b6b6b6', '#aaaaaa']);
