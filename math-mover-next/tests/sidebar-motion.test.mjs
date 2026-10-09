import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../components/DashboardSidebar.tsx', import.meta.url), 'utf8');

test('sidebar has a short explicit width transition, without scaling its text or canvas', () => {
  assert.match(css, /\.dashboard-sidebar\s*\{[^}]*width:\s*256px;[^}]*transition:\s*width 240ms cubic-bezier\(0\.25, 1, 0\.5, 1\)/);
  assert.match(css, /\.dashboard-sidebar\[data-collapsed='true'\]\s*\{\s*width:\s*56px;/);
  assert.doesNotMatch(css.slice(css.indexOf('/* Keep sidebar')), /scale\(|transition:\s*all/);
});

test('both sidebar layers stay mounted for reversal, while inactive controls are inert', () => {
  assert.match(sidebar, /aria-label="快捷侧栏" aria-hidden=\{!sidebar\?\.collapsed\} inert=\{!sidebar\?\.collapsed\}/);
  assert.match(sidebar, /sidebar-expanded-clip[^\n]*inert=\{sidebar\?\.collapsed\} aria-hidden=\{sidebar\?\.collapsed\}/);
  assert.doesNotMatch(sidebar, /sidebar\?\.collapsed &&|\shidden=\{sidebar\?\.collapsed\}/);
});

test('reduced motion disables width, fading and sliding together', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.dashboard-sidebar, \.sidebar-expanded-clip, \.sidebar-expanded, \.sidebar-rail\s*\{\s*transition: none !important;/);
});
