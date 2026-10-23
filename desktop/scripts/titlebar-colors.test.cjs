const { test } = require('node:test');
const assert = require('node:assert/strict');
const { blend, titleBarColor, TITLEBAR_COLORS } = require('../src/titlebar-colors.cjs');

test('settings overlay (stone-900 / 40%) matches the page backdrop', () => {
  assert.equal(blend(TITLEBAR_COLORS.light.color, { r: 28, g: 25, b: 23, a: 0.4 }), '#a3a19e');
});

test('reading dialog overlay (30% black at 45%) blends accordingly', () => {
  assert.equal(blend(TITLEBAR_COLORS.light.color, { r: 28, g: 25, b: 23, a: 0.45 }), '#989693');
});

test('heavy 80% overlays dim further instead of using one fixed tone', () => {
  assert.equal(blend(TITLEBAR_COLORS.light.color, { r: 0, g: 0, b: 0, a: 0.8 }), '#333232');
});

test('dark theme blends over the dark title bar', () => {
  assert.equal(blend(TITLEBAR_COLORS.dark.color, { r: 17, g: 17, b: 17, a: 0.4 }), '#151515');
});

test('no overlay keeps the base color', () => {
  assert.equal(titleBarColor('light', null), '#fdfcf8');
  assert.equal(titleBarColor('dark', null), '#181818');
  assert.equal(blend('#fdfcf8', { r: 28, g: 25, b: 23, a: 0 }), '#fdfcf8');
});
