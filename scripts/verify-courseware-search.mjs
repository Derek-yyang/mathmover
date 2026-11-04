import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { setupOrganizationFixture } from './verify-courseware-organization.mjs';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Isolated library/configuration/board fixtures; never modifies the user's data.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const out = 'spike-out/courseware-search';
await mkdir(out, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10_000);
  await stubConstructionDraft(page);
  await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
  const fixture = await setupOrganizationFixture(page);
  const records = [...fixture.records.values()];
  records.forEach((record, index) => { record.updated_at = new Date(Date.now() - index * 86_400_000).toISOString(); });
  records[0].pinned_at = new Date().toISOString();
  fixture.projects.set('search-project', { id: 'search-project', name: '立体几何', revision: 1 });
  records[1].project_id = 'search-project';
  records[8].archived_at = new Date().toISOString();
  await page.reload();
  const trigger = () => page.getByRole('button', { name: '搜索课件', exact: true });
  const dialog = page.getByRole('dialog', { name: '搜索课件', exact: true });
  const input = dialog.getByRole('combobox', { name: '搜索课件标题', exact: true });
  const options = dialog.getByRole('option');
  const open = async () => { await trigger().click(); await input.waitFor(); await input.evaluate(el => el === document.activeElement).then(value => assert(value)); };
  const close = async () => { await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); };
  assert.equal(await page.locator('aside[aria-label=课件侧栏]').getByRole('searchbox').count(), 0, 'no permanent sidebar search field');
  const header = page.locator('aside[aria-label=课件侧栏] [data-sidebar=header]');
  // Search belongs to the same header as branding and collapse.
  assert(await trigger().evaluate(el => el.closest('header, [data-slot=sidebar-header], [data-sidebar=header]') !== null));
  await open();
  await options.nth(7).waitFor();
  assert.deepEqual(await options.allTextContents(), records.slice(0, 8).map(record => record.title + (record.project_id ? '立体几何' : '')));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/light.png` });
  await input.fill('三棱锥');
  assert.equal(await options.count(), 1, 'project courseware is searchable');
  assert.match(await options.innerText(), /立体几何/);
  await input.fill('不存在的名称');
  await dialog.getByText('没有找到匹配的课件', { exact: true }).waitFor();
  assert.equal(await options.count(), 0);
  await close();
  assert(await trigger().evaluate(el => el === document.activeElement), 'Escape returns focus to the header button');
  await open();
  assert.equal(await input.inputValue(), '', 'reopening starts with recent courseware');
  await input.fill('三棱锥');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForURL(url => url.searchParams.get('history_id') === records[1].id);
  await dialog.waitFor({ state: 'detached' });
  // Keyboard navigation chooses another item without changing the search text.
  await open();
  await input.fill('示例课件');
  await page.keyboard.press('ArrowDown');
  const selected = await dialog.locator('[cmdk-item][data-selected=true]').getAttribute('data-value');
  await page.keyboard.press('Enter');
  await page.waitForURL(url => url.searchParams.get('history_id') === selected);
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await open();
  assert.equal(await page.locator('.dashboard-sidebar').getAttribute('data-collapsed'), 'true', 'rail search does not expand sidebar');
  await close();
  assert(await trigger().evaluate(el => el === document.activeElement), 'focus returns to the rail button');
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
  for (const [theme, width, height] of [['dark', 1440, 900], ['light', 390, 700]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => window.dispatchEvent(new StorageEvent('storage', { key: 'mm.theme', newValue: theme })), theme);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    await open();
    const bounds = await dialog.boundingBox();
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${theme}-${width}.png` });
    await dialog.getByRole('button', { name: '关闭搜索' }).click();
    await dialog.waitFor({ state: 'detached' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  fixture.records.clear();
  await page.reload();
  await open();
  await dialog.getByText('暂无课件', { exact: true }).waitFor();
  await close();
  assert.deepEqual(fixture.errors, []);
  console.log('PASS: header/rail search, recent ordering, pinned/project records, archive exclusion, empty/no-match, keyboard open, focus restoration, dark and narrow layout.');
} finally { await browser.close(); }
