import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// All storage API requests are fixtures: never create a backup or change the user's database.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1544, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let failDirectory = true, failBackup = true, backupCalls = 0, releaseBackup;
await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [{ id: 'claude-code', name: 'Claude Code', version: 'fixture', usable: true, authStatus: 'ok' }] } }));
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.route('**/api/coursewares**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.includes('/windows')) return route.fulfill({ json: { ok: true } });
  if (url.pathname.endsWith('/backup')) {
    assert.equal(route.request().method(), 'POST');
    assert.deepEqual(route.request().postDataJSON(), {});
    backupCalls++;
    if (failBackup) return route.fulfill({ status: 503, json: { error: '备份失败测试' } });
    await new Promise(resolve => { releaseBackup = resolve; });
    return route.fulfill({ json: { name: 'fixture-backup' } });
  }
  assert.equal(route.request().method(), 'GET');
  if (!url.search && failDirectory) return route.fulfill({ status: 503, json: { error: '目录读取失败测试' } });
  return route.fulfill({ json: { records: [], dataDirectory: 'C:\\Users\\Fixture\\AppData\\Local\\MathMover', capabilities: { archive: true, permanentDelete: true } } });
});

try {
  await page.goto(`${process.argv[2] || 'http://localhost:3000'}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.locator('span[aria-label="当前 Agent：Claude Code"]').waitFor();
  await page.addStyleTag({ content: 'nextjs-portal { display:none !important; }' });
  assert.equal(await page.getByRole('button', { name: '本地课件库', exact: true }).count(), 0);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '设置分区' });
  await nav.getByRole('button', { name: '数据与存储', exact: true }).click();
  const storage = page.getByRole('region', { name: '数据与存储', exact: true });
  await storage.getByRole('alert').filter({ hasText: '目录读取失败测试' }).waitFor();
  failDirectory = false;
  await storage.getByRole('button', { name: '重新读取', exact: true }).click();
  await storage.getByRole('status').filter({ hasText: 'C:\\Users\\Fixture' }).waitFor();
  await storage.getByRole('button', { name: '创建备份', exact: true }).click();
  await storage.getByRole('alert').filter({ hasText: '备份失败测试' }).waitFor();
  failBackup = false;
  await storage.getByRole('button', { name: '创建备份', exact: true }).evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => document.querySelector('section[aria-labelledby="data-storage-title"] button')?.disabled);
  await nav.getByRole('button', { name: '帮助与快捷键', exact: true }).click();
  await nav.getByRole('button', { name: '数据与存储', exact: true }).click();
  assert(await storage.getByRole('button', { name: '正在备份…', exact: true }).isDisabled());
  assert.equal(backupCalls, 2, 'rapid clicks and section switches must not duplicate the pending backup');
  releaseBackup();
  await storage.getByRole('status').filter({ hasText: 'backups/fixture-backup' }).waitFor();
  assert(await storage.getByRole('button', { name: '创建备份', exact: true }).isEnabled());
  await mkdir('spike-out/data-storage-settings', { recursive: true });
  await page.locator('dialog[aria-labelledby=settings-title]').screenshot({ path: 'spike-out/data-storage-settings/settings.png' });
  assert.equal(await storage.evaluate(element => element.scrollWidth > element.clientWidth), false);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await nav.getByRole('button', { name: '数据与存储', exact: true }).click();
  await storage.getByRole('status').filter({ hasText: 'C:\\Users\\Fixture' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Data/storage Settings passed: footer removal, directory retry, backup failure/retry, pending state across sections, collapsed sidebar entry. Fixtures only.');
} finally {
  releaseBackup?.();
  await browser.close();
}
