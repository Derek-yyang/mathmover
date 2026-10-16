import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Real dashboard UI with isolated API fixtures. No database/draft mutations.
const out = 'spike-out/sidebar-selection';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const now = new Date().toISOString(), errors = [], layouts = [];
const records = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '画一个边长为1的正方体' },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: '圆的性质' },
].map(row => ({ ...row, revision: 1, archived_at: null, created_at: now, updated_at: now, commands: [], messages: [] }));
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [] } }));
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await page.route('**/api/coursewares**', route => {
  if (new URL(route.request().url()).pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture' } });
  assert.equal(route.request().method(), 'GET', 'selection/cancel must not mutate fixture records');
  return route.fulfill({ json: { records, capabilities: { archive: true, permanentDelete: true } } });
});
await stubConstructionDraft(page);
try {
  await page.goto('http://localhost:3000/dashboard?action=new');
  const sidebar = page.locator('aside[aria-label=课件侧栏]');
  await sidebar.getByRole('button', { name: '选择', exact: true }).click();
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  const bar = sidebar.getByRole('group', { name: '课件批量操作', exact: true });
  const remove = bar.getByRole('button', { name: '删除所选课件', exact: true });
  assert(await remove.isDisabled());
  await sidebar.screenshot({ path: `${out}/none.png` });
  await bar.getByRole('button', { name: '全选', exact: true }).click();
  assert.equal(await bar.getByText('已选 2 项', { exact: true }).count(), 1);
  assert(await remove.isEnabled());
  await bar.getByRole('button', { name: '取消全选', exact: true }).click();
  assert(await remove.isDisabled());
  const search = sidebar.getByRole('searchbox', { name: '搜索课件标题' });
  await search.fill('正方体');
  await bar.getByRole('button', { name: '全选结果', exact: true }).click();
  assert.equal(await bar.getByText('已选 1 项', { exact: true }).count(), 1);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.dispatchEvent(new StorageEvent('storage', { key: 'mm.theme', newValue: theme })), theme);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
    const geometry = await bar.evaluate(el => {
      const rect = el.getBoundingClientRect();
      return { height: rect.height, width: el.clientWidth, scroll: el.scrollWidth,
        centers: [...el.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect(); return r.y + r.height / 2; }) };
    });
    assert.equal(geometry.height, 36);
    assert.equal(geometry.width, geometry.scroll);
    assert(Math.abs(geometry.centers[0] - geometry.centers[1]) < 1);
    layouts.push({ theme, ...geometry });
    await sidebar.screenshot({ path: `${out}/${theme}-selected.png` });
  }
  await remove.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await bar.getByText('已选 1 项', { exact: true }).count(), 1, 'cancel preserves selection');
  await sidebar.getByRole('button', { name: '取消选择', exact: true }).click();
  await bar.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  await writeFile(`${out}/results.json`, JSON.stringify({ passed: true, errors, layouts, selectionAndCancel: true }, null, 2));
  console.log('PASS: compact selection toolbar, disabled/delete states, select all/filter, keyboard confirmation/cancel, light/dark.');
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` });
  throw error;
} finally { await browser.close(); }
