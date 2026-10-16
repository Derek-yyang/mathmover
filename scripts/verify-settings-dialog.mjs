import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Isolated APIs: no real config writes, courseware deletion or CLI invocation.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1544, height: 900 } });
page.setDefaultTimeout(10_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [] } }));
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [], bindingToken: 'fixture' } }));
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await stubConstructionDraft(page);
try {
  await page.goto('http://localhost:3000/dashboard?action=new');
  const trigger = page.getByRole('button', { name: '设置', exact: true });
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  for (const mode of ['fresh', 'theme']) {
    await trigger.click();
    await dialog.waitFor();
    await page.waitForTimeout(250);
    if (mode === 'theme') {
      await dialog.getByRole('button', { name: '外观', exact: true }).click();
      await dialog.getByRole('button', { name: /^主题模式/ }).click();
      await page.getByRole('menu').waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('menu').waitFor({ state: 'detached' });
    }
    await page.mouse.click(5, 300);
    await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '设置');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: first backdrop click closes fresh Settings and Settings after theme-menu Escape; focus restores on repeated opening.');
} finally { await browser.close(); }
