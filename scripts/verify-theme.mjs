import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const output = new URL('../spike-out/theme-audit/', import.meta.url);
await mkdir(output, { recursive: true });
const screenshotPath = name => fileURLToPath(new URL(name, output));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const id = '00000001-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const record = {
  id, title: '主题检查课件', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['A=(1,2)'], messages: [
    { id: 'u1', role: 'user', content: '请画一个点', createdAt: 1 },
    { id: 'a1', role: 'assistant', content: '点位于第一象限，坐标为 $(1,2)$。', createdAt: 2, meta: { status: 'completed' } },
  ],
};

await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [] } }));
await page.route('**/api/byok', route => route.fulfill({ json: { baseUrl: '', model: '', apiKeyConfigured: false, apiKeyTail: '' } }));
await page.route('**/api/coursewares**', route => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'theme-fixture-ticket' } });
  if (pathname === '/api/coursewares' && route.request().method() === 'POST') {
    return route.fulfill({ json: { ...record, ...route.request().postDataJSON(), revision: 2 } });
  }
  if (route.request().method() !== 'GET') throw new Error(`Unexpected courseware mutation: ${route.request().url()}`);
  return route.fulfill({ json: pathname.endsWith(id) ? record : { records: [record], capabilities: { archive: true, permanentDelete: true } } });
});
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await stubConstructionDraft(page, { commands: record.commands });

async function surfaceColors() {
  return page.evaluate(() => {
    const css = element => getComputedStyle(document.querySelector(element)).backgroundColor;
    return {
      theme: document.documentElement.dataset.theme,
      body: getComputedStyle(document.body).backgroundColor,
      sidebar: css('.dashboard-sidebar'),
      toolbar: css('[data-slot="board-toolbar"]'),
      chat: css('aside[aria-label="对话"]'),
      dialog: css('[data-slot="settings-dialog"]'),
    };
  });
}

try {
  await page.goto(`${base}/dashboard?history_id=${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('textbox', { name: '题目描述' }).waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => {
    const title = document.querySelector('button[aria-label^="重命名课件："]');
    return title && !title.disabled;
  });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'new users start with the established light theme');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '外观' }).click();
  const themeTrigger = page.getByRole('button', { name: /^主题模式/ });
  await themeTrigger.waitFor();
  async function selectTheme(label) {
    await page.getByRole('menu').waitFor({ state: 'detached' });
    await themeTrigger.click();
    await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  }
  const light = await surfaceColors();
  await page.screenshot({ path: screenshotPath('light-settings.png') });

  await themeTrigger.click();
  assert.equal(await page.getByRole('menuitemradio', { name: '浅色', exact: true }).getAttribute('aria-checked'), 'true');
  await page.waitForTimeout(250);
  await page.screenshot({ path: screenshotPath('light-theme-menu.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-labelledby')?.includes('theme-mode-label'));
  assert.equal(await page.getByRole('dialog', { name: '设置', exact: true }).isVisible(), true, 'Escape closes only the menu');
  assert.equal(await themeTrigger.evaluate(element => element === document.activeElement), true, 'focus returns to theme trigger');
  await selectTheme('深色');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => localStorage.getItem('mm.theme')), 'dark');
  const dark = await surfaceColors();
  for (const part of ['body', 'sidebar', 'toolbar', 'chat', 'dialog']) {
    assert.notEqual(dark[part], light[part], `${part} responds to dark theme`);
  }
  await page.screenshot({ path: screenshotPath('dark-settings.png') });
  await themeTrigger.click();
  assert.equal(await page.getByRole('menuitemradio', { name: '深色', exact: true }).getAttribute('aria-checked'), 'true');
  await page.waitForTimeout(250);
  await page.screenshot({ path: screenshotPath('dark-theme-menu.png') });
  await page.keyboard.press('Escape');
  const nav = page.getByRole('navigation', { name: '设置分区' });
  await nav.getByRole('button', { name: '模型与提供商' }).click();
  await page.getByRole('tab', { name: 'API 提供商' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: screenshotPath('dark-provider-settings.png') });
  await nav.getByRole('button', { name: '数据与存储' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: screenshotPath('dark-storage-settings.png') });
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.screenshot({ path: screenshotPath('dark-workbench.png') });
  const row = page.locator('aside[aria-label="课件侧栏"] [data-slot="aui_thread-list-item"]').first();
  await row.hover();
  await row.getByRole('button', { name: '课件操作' }).click();
  await page.getByRole('menu').waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: screenshotPath('dark-courseware-menu.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByRole('menu', { name: '导出' }).waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({ path: screenshotPath('dark-export-menu.png') });
  await page.keyboard.press('Escape');
  const landing = await context.newPage();
  await landing.goto(base, { waitUntil: 'domcontentloaded' });
  await landing.locator('h1').waitFor();
  assert.equal(await landing.locator('html').getAttribute('data-theme'), 'dark', 'landing shares the saved theme');
  await landing.screenshot({ path: screenshotPath('dark-landing.png') });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '外观' }).click();
  await selectTheme('浅色');
  await landing.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await selectTheme('深色');
  await landing.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await landing.close();

  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'pre-paint script restores theme');
  await page.waitForFunction(() => typeof window.ggbApplet?.getAllObjectNames === 'function');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '外观' }).click();
  await themeTrigger.click();
  assert.equal(await page.getByRole('menuitemradio', { name: '深色', exact: true }).getAttribute('aria-checked'), 'true', 'control restores the saved preference');
  await page.keyboard.press('Escape');

  await selectTheme('跟随系统');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await themeTrigger.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('menuitemradio', { name: '浅色', exact: true }).waitFor();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitemradio' && document.activeElement.textContent?.trim() === '浅色');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.screenshot({ path: screenshotPath('light-workbench.png') });

  // Equivalent to a 1366px laptop at 150% display scaling; this does not
  // change the OS display settings.
  await page.setViewportSize({ width: 910, height: 512 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '外观' }).click();
  await selectTheme('深色');
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await themeTrigger.click();
  const menuBounds = await page.getByRole('menu').boundingBox();
  assert(menuBounds.x >= 0 && menuBounds.y >= 0 && menuBounds.x + menuBounds.width <= 910 && menuBounds.y + menuBounds.height <= 512, 'theme menu fits the compact viewport');
  await page.screenshot({ path: screenshotPath('dark-compact-theme-menu.png') });
  await page.keyboard.press('Escape');
  await selectTheme('浅色');

  assert.deepEqual(errors, [], 'no page errors');
  console.log({ light, dark, errors, result: 'theme switching, persistence, system changes, cross-window sync, keyboard navigation and compact layout passed' });
} catch (error) {
  await page.screenshot({ path: screenshotPath('failure.png') }).catch(() => {});
  console.error({ errors, toolbar: await page.locator('[data-slot="board-toolbar"]').innerText().catch(() => '') });
  throw error;
} finally {
  await browser.close();
}
