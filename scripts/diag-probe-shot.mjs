/**
 * 在截图里按给定坐标逐像素取样（排查画板外框那几道线用）。
 *
 * 用法：node scripts/diag-probe-shot.mjs <pngPath> '<json>'
 *   json: [{ "label": "...", "axis": "y", "fixed": 700, "from": 45, "to": 70 }, ...]
 *   axis=y 表示固定 x=fixed、沿 y 扫；axis=x 表示固定 y=fixed、沿 x 扫。
 */

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const file = process.argv[2];
const spec = JSON.parse(process.argv[3] ?? '[]');
const b64 = readFileSync(file).toString('base64');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');
const out = await page.evaluate(async ({ data, spec }) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + data; });
  const c = document.querySelector('#c');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const px = (x, y) => {
    const d = g.getImageData(x, y, 1, 1).data;
    return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  };
  return { size: { W: img.width, H: img.height }, results: spec.map((probe) => {
    const runs = [];
    for (let i = probe.from; i <= probe.to; i++) {
      const [x, y] = probe.axis === 'y' ? [probe.fixed, i] : [i, probe.fixed];
      const color = px(x, y);
      const last = runs[runs.length - 1];
      if (last && last.color === color) last.end = i;
      else runs.push({ start: i, end: i, color });
    }
    return { label: probe.label, runs };
  }) };
}, { data: b64, spec });

console.log('尺寸:', out.size);
for (const r of out.results) {
  console.log(`\n${r.label}`);
  for (const run of r.runs) console.log(`  ${run.color}  ${run.start}..${run.end}  (${run.end - run.start + 1}px)`);
}
await browser.close();
