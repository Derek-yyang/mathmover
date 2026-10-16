import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Isolated fixtures: no real secrets/config, courseware mutations or Agent calls.
const out = 'spike-out/settings-unsaved';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1544, height: 900 } });
page.setDefaultTimeout(10_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let config = { baseUrl: 'https://saved.fixture.invalid/v1', model: 'saved-model', apiKeyConfigured: true, apiKeyTail: '1234' };
let saveMode = 'ok', releaseSave, saves = 0;
const archiveId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const archive = { id: archiveId, title: '归档草稿保护验收', revision: 1, archived_at: new Date().toISOString(),
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), messages: [], commands: [] };
await page.route('**/api/agent**', route => {
  assert.equal(route.request().method(), 'GET');
  return route.fulfill({ json: { runtimes: [] } });
});
await page.route('**/api/byok', async route => {
  if (route.request().method() === 'GET') return route.fulfill({ json: config });
  saves++;
  if (saveMode === 'hold') await new Promise(resolve => { releaseSave = resolve; });
  if (saveMode === 'fail') return route.fulfill({ status: 503, json: { error: '验收：保存失败' } });
  const body = route.request().postDataJSON();
  config = { ...config, baseUrl: body.baseUrl.trim(), model: body.model.trim() };
  return route.fulfill({ json: config });
});
await page.route('**/api/coursewares**', route => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture-ticket' } });
  if (path === '/api/coursewares' && route.request().method() === 'POST') {
    return route.fulfill({ json: { ...archive, ...route.request().postDataJSON(), revision: 2 } });
  }
  assert.equal(route.request().method(), 'GET', 'no courseware mutations');
  return route.fulfill({ json: path.endsWith(archiveId) ? archive : { records: [archive] } });
});
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await stubConstructionDraft(page);
const settings = page.getByRole('dialog', { name: '设置', exact: true });
const trigger = page.getByRole('button', { name: '设置', exact: true });
const close = settings.getByRole('button', { name: '关闭设置', exact: true });
const confirm = page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true });
const endpoint = settings.getByRole('textbox', { name: 'API 端点', exact: true });
const model = settings.getByRole('textbox', { name: '模型', exact: true });
const key = settings.locator('input[type=password]');
const save = settings.getByRole('button', { name: '保存', exact: true });
const continueEditing = confirm.getByRole('button', { name: '继续编辑', exact: true });
const discard = confirm.getByRole('button', { name: '放弃并关闭', exact: true });
async function openApi() {
  await trigger.click();
  await settings.getByRole('tab', { name: 'API 提供商', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#settings-panel-providers input[type=url]')?.disabled);
}
async function expectClosed() {
  await settings.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '设置');
  assert(await trigger.evaluate(el => el === document.activeElement));
}
try {
  await page.goto('http://localhost:3000/dashboard?action=new', { timeout: 60_000 });
  await page.addStyleTag({ content: 'nextjs-portal {display:none !important;}' });
  await openApi();
  await close.click();
  await expectClosed();
  assert.equal(await confirm.count(), 0, 'pristine close is immediate');

  await openApi();
  await endpoint.fill('https://draft.fixture.invalid/v1');
  await model.fill('draft-model');
  await key.fill('fixture-unsaved-secret');
  await close.click();
  await confirm.waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent === '继续编辑');
  await continueEditing.click();
  await confirm.waitFor({ state: 'detached' });
  assert.equal(await endpoint.inputValue(), 'https://draft.fixture.invalid/v1');
  assert.equal(await model.inputValue(), 'draft-model');
  assert(await key.inputValue(), 'continue preserves unsaved key');

  await endpoint.focus();
  await page.keyboard.press('Escape');
  await confirm.waitFor();
  await page.keyboard.press('Escape');
  await confirm.waitFor({ state: 'detached' });
  assert(await settings.isVisible(), 'Escape cancels confirmation only');
  await page.waitForFunction(() => document.activeElement?.getAttribute('type') === 'url');
  await endpoint.fill(config.baseUrl);
  await model.fill(config.model);
  await key.fill('');
  await page.keyboard.press('Escape');
  await expectClosed();
  assert.equal(saves, 0, 'revert/close never saves');

  await openApi();
  await model.fill('model-only-draft');
  await page.keyboard.press('Escape');
  await confirm.waitFor();
  await discard.click();
  await expectClosed();
  await openApi();
  assert.equal(await model.inputValue(), config.model, 'discard restores saved model on reopening');
  await key.fill('fixture-unsaved-secret');
  await page.mouse.click(5, 300);
  await confirm.waitFor();
  for (const width of [1544, 910]) {
    await page.setViewportSize({ width, height: width === 910 ? 512 : 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => window.dispatchEvent(new StorageEvent('storage', { key: 'mm.theme', newValue: theme })), theme);
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      const bounds = await confirm.boundingBox(), panel = await settings.boundingBox();
      assert(bounds.x >= panel.x && bounds.y >= panel.y && bounds.x + bounds.width <= panel.x + panel.width && bounds.y + bounds.height <= panel.y + panel.height, 'confirmation stays within Settings');
      assert(bounds.width <= 290 && bounds.height < 180, 'confirmation stays compact');
      await settings.screenshot({ path: `${out}/${width}-${theme}.png` });
    }
  }
  await discard.click();
  await expectClosed();
  assert.equal(saves, 0, 'discarded endpoint/model/key never save');
  assert(!(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes('fixture-unsaved-secret'), 'key draft is not browser-persisted');

  await page.setViewportSize({ width: 1544, height: 900 });
  await openApi();
  assert.equal(await key.inputValue(), '');
  await endpoint.fill('https://save.fixture.invalid/v1');
  saveMode = 'fail';
  await save.click();
  await settings.getByRole('alert').filter({ hasText: '保存 BYOK 配置失败' }).waitFor();
  await close.click();
  await confirm.waitFor();
  await continueEditing.click();
  await confirm.waitFor({ state: 'detached' });
  assert.equal(await endpoint.inputValue(), 'https://save.fixture.invalid/v1');

  saveMode = 'hold';
  await save.click();
  await settings.getByRole('button', { name: '保存中…', exact: true }).waitFor();
  await close.click();
  await confirm.getByText('配置正在保存，请稍候。', { exact: true }).waitFor();
  assert(await discard.isDisabled(), 'pending save cannot be discarded');
  for (let i = 0; !releaseSave && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert(releaseSave);
  releaseSave();
  await confirm.waitFor({ state: 'detached' });
  await settings.getByRole('status').filter({ hasText: '已保存' }).waitFor();
  await close.click();
  await expectClosed();
  assert.equal(saves, 2, 'one failed and one successful explicit save');

  // Navigation through the archive list must pass the same draft guard first.
  await openApi();
  await model.fill('archive-navigation-draft');
  await settings.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '归档课件', exact: true }).click();
  await settings.getByRole('button', { name: archive.title, exact: true }).click();
  await confirm.waitFor();
  assert(!new URL(page.url()).searchParams.has('history_id'), 'navigation is deferred before confirmation');
  await continueEditing.click();
  await confirm.waitFor({ state: 'detached' });
  assert(await settings.isVisible());
  await settings.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '模型与提供商', exact: true }).click();
  assert.equal(await model.inputValue(), 'archive-navigation-draft');
  await settings.getByRole('navigation', { name: '设置分区' }).getByRole('button', { name: '归档课件', exact: true }).click();
  await settings.getByRole('button', { name: archive.title, exact: true }).click();
  await discard.click();
  await page.waitForURL(url => url.searchParams.get('history_id') === archiveId);
  await expectClosed();
  assert.deepEqual(errors, []);
  console.log('PASS: pristine/reverted close, X/Escape/backdrop draft guard, continue/discard, key drafts, failed/pending/successful saves, cross-section archive navigation, focus and light/dark/compact confirmation.');
} catch (error) {
  console.error({ pageErrors: errors });
  await page.screenshot({ path: `${out}/failure.png` }).catch(() => {});
  throw error;
} finally { releaseSave?.(); await browser.close(); }
