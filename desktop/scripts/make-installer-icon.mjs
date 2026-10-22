/**
 * 生成独立的安装器图标：品牌 M + 下载标记。
 * 重跑：node scripts/make-installer-icon.mjs（在 desktop 目录下）。
 * 复用现有 Playwright 和 electron-builder 的 ICO 转换器，无需增加依赖。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { convertIcon } = require('app-builder-lib/out/util/iconConverter.js');
const desktopDir = path.resolve(import.meta.dirname, '..');
const resourcesDir = path.join(desktopDir, 'build-resources');
const pngPath = path.join(resourcesDir, 'installerIcon.png');
const icoPath = path.join(resourcesDir, 'installerIcon.ico');
const appIcon = await fs.readFile(path.join(resourcesDir, 'icon.png'));
const svg = (await fs.readFile(path.join(resourcesDir, 'installerIcon.svg'), 'utf8'))
  .replace('href="icon.png"', `href="data:image/png;base64,${appIcon.toString('base64')}"`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
  await page.locator('svg image').evaluate(async (image) => {
    const loaded = new Image();
    loaded.src = image.getAttribute('href');
    await loaded.decode();
  });
  await page.locator('svg').screenshot({ path: pngPath, omitBackground: true });
} finally {
  await browser.close();
}

const result = await convertIcon({
  sources: [pngPath],
  fallbackSources: [],
  roots: [resourcesDir],
  format: 'ico',
  outDir: path.join(desktopDir, 'release', 'installer-icon'),
});
if (result.isFallback || result.icons.length !== 1) {
  throw new Error('安装器图标转换失败');
}
await fs.copyFile(result.icons[0].file, icoPath);
console.log('installer icons:', pngPath, icoPath);
