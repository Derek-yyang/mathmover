/**
 * 标题栏颜色：基础色 + 模态遮罩的预混合。
 *
 * Windows 的原生按钮区由 DWM 画在网页之上，网页遮罩盖不到它；模态打开时只能把
 * 这块原生底色改成"遮罩盖在标题栏上"的合成色。遮罩颜色由渲染进程从实际元素上
 * 读出来（不同的弹窗用 35% / 40% / 45% / 80% 不等），这里只做混合。
 */
const TITLEBAR_COLORS = {
  light: { color: '#fdfcf8', symbolColor: '#1c1917' },
  dark: { color: '#181818', symbolColor: '#fafaf9' },
};

// 渲染进程没给出遮罩颜色时的兜底：与设置弹窗一致（stone-900 / 40%）。
const DEFAULT_OVERLAY = { r: 28, g: 25, b: 23, a: 0.4 };

function parseHex(hex) {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!value) return { r: 0, g: 0, b: 0 };
  const int = parseInt(value[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function toHex({ r, g, b }) {
  return `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** 把 overlay 盖到 base 上得到的颜色；overlay 为空时原样返回 base。 */
function blend(baseHex, overlay) {
  if (!overlay || !(overlay.a > 0)) return baseHex;
  const base = parseHex(baseHex);
  const mix = (c, o) => c * (1 - overlay.a) + o * overlay.a;
  return toHex({ r: mix(base.r, overlay.r), g: mix(base.g, overlay.g), b: mix(base.b, overlay.b) });
}

function titleBarColor(theme, overlay) {
  const colors = TITLEBAR_COLORS[theme === 'dark' ? 'dark' : 'light'];
  return overlay ? blend(colors.color, overlay) : colors.color;
}

module.exports = { TITLEBAR_COLORS, DEFAULT_OVERLAY, blend, titleBarColor };
