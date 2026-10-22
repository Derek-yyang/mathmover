/**
 * 生成桌面应用图标（512×512 PNG + 多尺寸 ICO，供 Windows 托盘使用）。
 *
 * 设计沿用 app/icon.tsx 的 favicon：品牌绿 #10b981、圆角方块、白色 M。
 * 改设计时重跑：node scripts/make-icon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const out = path.resolve(import.meta.dirname, '..', 'build-resources', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
  <div id="icon" style="width:512px;height:512px;border-radius:128px;background:#10b981;display:flex;align-items:center;justify-content:center;color:#ffffff;font:900 320px Arial,Helvetica,sans-serif;letter-spacing:-8px">M</div>
</body></html>`);
await page.locator('#icon').screenshot({ path: out, omitBackground: true });
await browser.close();
console.log('icon:', out, fs.statSync(out).size + 'B');

const require = createRequire(import.meta.url);
const { convertIcon } = require('app-builder-lib/out/util/iconConverter.js');
const result = await convertIcon({
  sources: [out], fallbackSources: [], roots: [path.dirname(out)],
  format: 'ico', outDir: path.resolve(import.meta.dirname, '..', 'release', 'app-icon'),
});
if (result.isFallback || result.icons.length !== 1) throw new Error('应用 ICO 生成失败');
const ico = path.join(path.dirname(out), 'icon.ico');
fs.copyFileSync(result.icons[0].file, ico);
console.log('icon:', ico, fs.statSync(ico).size + 'B');
