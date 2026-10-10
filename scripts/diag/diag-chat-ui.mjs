/** 诊断 UI 发消息链路：console / 网络 / 面板全文。临时诊断用。 */
import { chromium } from 'playwright';

const b = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-features=LocalNetworkAccessChecks', '--allow-insecure-localhost'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });

p.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 200)));
p.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
p.on('requestfailed', (r) => console.log('[requestfailed]', r.url().slice(0, 120), r.failure()?.errorText));
p.on('response', async (r) => {
  if (r.url().includes('/api/')) {
    let bodyHead = '';
    try { bodyHead = (await r.text()).slice(0, 200); } catch {}
    console.log('[api]', r.status(), r.url().slice(0, 120), '|', bodyHead.replace(/\n/g, '⏎'));
  }
});

await p.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 30; i++) {
  await p.waitForTimeout(1000);
  if (await p.evaluate(() => !!window.__mmGgb)) break;
}

const ta = p.locator('textarea[placeholder*="输入题目描述"]');
await ta.click();
await ta.fill('用一句话说你好');
await ta.press('Enter');
console.log('--- 已发送，等 15s ---');
await p.waitForTimeout(15000);

const body = await p.locator('body').innerText();
console.log('--- 面板全文尾部 600 字 ---');
console.log(body.slice(-600));

await b.close();
