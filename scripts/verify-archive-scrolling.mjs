import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// In-memory courseware fixtures; no database mutations or Agent runs.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const viewport of [{ width: 974, height: 768 }, { width: 1544, height: 900 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const records = Array.from({ length: 70 }, (_, index) => ({
      id: `fixture-${index}`, title: `${index < 40 ? '最近' : '归档'}课件 ${index}`,
      revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      archived_at: index < 40 ? null : new Date().toISOString(),
    }));
    await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [{ id: 'claude-code', name: 'Claude Code', version: 'fixture', usable: true }] } }));
    await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
    await page.route('**/api/coursewares**', route => {
      if (new URL(route.request().url()).pathname.includes('/windows')) return route.fulfill({ json: { ok: true } });
      assert.equal(route.request().method(), 'GET');
      return route.fulfill({ json: { records, dataDirectory: 'fixture', capabilities: { archive: true, permanentDelete: true } } });
    });
    await page.goto(`${process.argv[2] || 'http://localhost:3000'}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.locator('span[aria-label="当前 Agent：Claude Code"]').waitFor();
    await page.addStyleTag({ content: 'nextjs-portal { display:none !important; }' });
    const sidebarItems = page.locator('aside[aria-label=课件侧栏] [data-slot=aui_thread-list-items]');
    await page.getByRole('button', { name: '最近课件 0', exact: true }).hover();
    await page.mouse.wheel(0, 420);
    await page.waitForFunction(() => document.querySelector('aside[aria-label=课件侧栏] [data-slot=aui_thread-list-items]').scrollTop > 100);
    const sidebarTop = await sidebarItems.evaluate(element => element.scrollTop);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '归档课件', exact: true }).click();
    const settings = page.locator('dialog[aria-labelledby=settings-title]');
    const scroll = settings.locator('.settings-scroll-viewport');
    const first = settings.getByRole('button', { name: '归档课件 40', exact: true });
    await first.hover();
    await page.mouse.wheel(0, 420);
    await page.waitForFunction(() => document.querySelector('dialog[open] .settings-scroll-viewport').scrollTop > 100);
    const down = await scroll.evaluate(element => element.scrollTop);
    const box = await scroll.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -420);
    await page.waitForFunction(previous => document.querySelector('dialog[open] .settings-scroll-viewport').scrollTop < previous, down);
    // Menu open/close must not leave a wheel lock behind.
    await first.hover();
    await first.locator('..').getByRole('button', { name: '课件操作', exact: true }).click();
    await page.getByRole('menu').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    await first.hover();
    await page.mouse.wheel(0, 420);
    await page.waitForFunction(() => document.querySelector('dialog[open] .settings-scroll-viewport').scrollTop > 100);
    assert.equal(await sidebarItems.evaluate(element => element.scrollTop), sidebarTop, 'modal wheel must not scroll the sidebar behind it');
    const archiveSearch = settings.getByRole('searchbox', { name: '搜索归档课件', exact: true });
    await archiveSearch.fill('不存在');
    await settings.getByText('没有找到匹配的课件', { exact: true }).waitFor();
    await archiveSearch.fill('');
    await first.hover();
    await page.mouse.wheel(0, 420);
    await page.waitForFunction(() => document.querySelector('dialog[open] .settings-scroll-viewport').scrollTop > 100);
    assert.deepEqual(errors, []);
    console.log(`Wheel scrolling passed at ${viewport.width}x${viewport.height}: sidebar, archives both directions, menu close, search reset, background isolation.`);
    await context.close();
  }
} finally { await browser.close(); }
