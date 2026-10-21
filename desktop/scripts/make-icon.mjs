/**
 * 生成桌面应用图标（512×512 PNG，electron-builder 会自动转 .ico）。
 *
 * 设计沿用 app/icon.tsx 的 favicon：品牌绿 #10b981、圆角方块、白色 M。
 * 改设计时重跑：node scripts/make-icon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
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
