/** 不依赖浏览器或系统字体；生成 macOS 浅/深色菜单栏共用的模板图标。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../math-mover-next/package.json', import.meta.url));
const sharp = require('sharp');
const output = path.resolve(import.meta.dirname, '../build-resources');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path fill="black" d="M3 16V4h3l4 7 4-7h3v12h-3V9l-4 7-4-7v7z"/></svg>');
for (const [size, suffix] of [[20, ''], [40, '@2x']]) {
  const file = path.join(output, `trayTemplate${suffix}.png`);
  await sharp(svg).resize(size, size).png().toFile(file);
  console.log(`菜单栏图标：${file} (${fs.statSync(file).size} bytes)`);
}
