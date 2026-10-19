import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Isolated UI fixtures only: no real secrets, backend writes or model requests.
const out = 'spike-out/byok-models';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1544, height: 900 } });
page.setDefaultTimeout(15_000);
const errors = [], requests = [], saves = [];
let config = { apiFormat: 'openai-chat', baseUrl: '', model: '', apiKeyConfigured: false, apiKeyTail: '' };
let mode = 'ok', release;
const models = [
  { id: 'alpha-fixture', label: 'Alpha Fixture' }, { id: 'beta-fixture', label: 'Beta Fixture' },
  ...Array.from({ length: 65 }, (_, i) => ({ id: `fixture-${i}-long-model-id-with-a-version-and-context-window`, label: `Fixture Model ${i}` })),
];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => {
  assert.equal(route.request().method(), 'GET');
  return route.fulfill({ json: { runtimes: [] } });
});
await page.route('**/api/byok', route => {
  if (route.request().method() === 'GET') return route.fulfill({ json: config });
  const body = route.request().postDataJSON(); saves.push(body);
  config = { ...config, baseUrl: body.baseUrl.trim(), model: body.model.trim(), apiFormat: body.apiFormat,
    apiKeyConfigured: true, apiKeyTail: '1234' };
  return route.fulfill({ json: config });
});
await page.route('**/api/byok/models', async route => {
  requests.push(route.request().postDataJSON());
  const current = mode;
  if (current === 'hold') await new Promise(resolve => { release = resolve; });
  return route.fulfill({ json: current === 'error' ? { ok: false, message: 'fixture：密钥未授权，请检查。' }
    : { ok: true, models: current === 'empty' ? [] : current === 'hold' ? [{ id: 'stale', label: 'Stale Model' }] : models } }).catch(() => {});
});
await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [], bindingToken: 'fixture' } }));
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await stubConstructionDraft(page);
const settings = page.getByRole('dialog', { name: '设置', exact: true });
const panel = page.getByRole('tabpanel', { name: '模型 API', exact: true });
const endpoint = panel.getByRole('textbox', { name: 'API 端点', exact: true });
const model = panel.getByRole('textbox', { name: '模型', exact: true });
const key = panel.getByLabel(/^API 密钥/);
const fetchModels = () => panel.getByRole('button', { name: '获取模型列表', exact: true });
const picker = page.locator('[cmdk-root]');
const search = page.getByRole('combobox', { name: '搜索模型', exact: true });
const open = async () => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '模型 API', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#settings-panel-providers [role=combobox]')?.disabled);
};
const fetchAndOpen = async () => { await fetchModels().click(); await picker.waitFor(); await search.waitFor(); };
const checkArrow = async () => {
  const trigger = panel.getByRole('button', { name: '从列表选择模型', exact: true });
  const field = await model.boundingBox(), arrow = await trigger.boundingBox();
  assert(Math.abs(field.y + field.height / 2 - arrow.y - arrow.height / 2) <= 0.5,
    `arrow must be centered inside the input: ${JSON.stringify({ field, arrow })}`);
  assert(arrow.x >= field.x + 1 && arrow.y >= field.y + 1 && arrow.x + arrow.width <= field.x + field.width - 1 && arrow.y + arrow.height <= field.y + field.height - 1,
    'arrow hit area stays inside the input border');
  await trigger.hover();
  assert.equal(await trigger.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'hover keeps the shared input surface');
};
try {
  await page.goto('http://localhost:3000/dashboard?action=new', { timeout: 60_000 });
  await open();
  assert(await fetchModels().isDisabled());
  await endpoint.fill('https://draft.fixture.invalid/v1'); await key.fill('fixture-new-key');
  const keyBounds = await key.boundingBox(), modelBounds = await model.boundingBox();
  assert(Math.abs(keyBounds.y - modelBounds.y) <= 1, 'key and model fields align');
  await page.screenshot({ path: `${out}/form-light.png`, animations: 'disabled' });
  await fetchAndOpen();
  await checkArrow();
  const arrowTrigger = panel.getByRole('button', { name: '从列表选择模型', exact: true });
  assert.equal(await arrowTrigger.getAttribute('data-state'), 'open');
  await arrowTrigger.click(); await picker.waitFor({ state: 'detached' });
  assert.equal(await arrowTrigger.getAttribute('data-state'), 'closed');
  await arrowTrigger.hover();
  await model.locator('..').screenshot({ path: `${out}/arrow-hover-light.png`, animations: 'disabled' });
  await arrowTrigger.click(); await picker.waitFor();
  await model.locator('..').screenshot({ path: `${out}/arrow-open-light.png`, animations: 'disabled' });
  assert.equal(saves.length, 0, 'discovery does not save drafts');
  assert.deepEqual(requests.at(-1), { apiFormat: 'openai-chat', baseUrl: 'https://draft.fixture.invalid/v1', apiKey: 'fixture-new-key' });
  assert.equal(await model.inputValue(), '', 'fetch does not replace a model implicitly');
  await search.fill('Beta Fixture');
  await picker.getByRole('option', { name: /Beta Fixture/ }).waitFor();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await picker.waitFor({ state: 'detached' }); assert.equal(await model.inputValue(), 'beta-fixture');
  await panel.getByRole('button', { name: '从列表选择模型', exact: true }).click();
  await search.fill('no-such-fixture');
  await picker.getByText('没有匹配模型，可关闭列表后手动输入。', { exact: true }).waitFor();
  await page.keyboard.press('Escape'); assert(await settings.isVisible());
  await model.fill('custom-model');
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await panel.getByText('已保存', { exact: true }).waitFor();
  await fetchAndOpen(); assert.equal(requests.at(-1).apiKey, '', 'blank key remains server-side');
  await page.keyboard.press('Escape');
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await settings.waitFor({ state: 'detached' });
  assert.equal(await page.getByText('放弃未保存的修改？', { exact: true }).count(), 0, 'discovery alone does not create a dirty draft');
  await open();

  mode = 'error'; await fetchModels().click();
  await panel.getByRole('alert').getByText('fixture：密钥未授权，请检查。', { exact: true }).waitFor();
  assert.equal(await model.inputValue(), 'custom-model');
  mode = 'empty'; await fetchModels().click();
  await panel.getByText('未返回模型，可手动输入模型 ID。', { exact: true }).waitFor();
  assert.equal(await panel.getByRole('button', { name: '从列表选择模型', exact: true }).count(), 0);
  mode = 'hold'; await fetchModels().click();
  await panel.getByRole('button', { name: '获取中…', exact: true }).waitFor();
  for (let i = 0; i < 100 && !release; i++) await page.waitForTimeout(20);
  assert(release);
  await endpoint.fill('https://changed.fixture.invalid/v1');
  release(); mode = 'ok'; await page.waitForTimeout(100);
  assert.equal(await picker.count(), 0, 'stale responses cannot open the old list');
  assert.equal(await panel.getByText('已获取 1 个模型', { exact: true }).count(), 0);
  assert.equal(await model.inputValue(), 'custom-model');
  await fetchAndOpen(); await page.keyboard.press('Escape');
  await key.fill('replacement-key');
  assert.equal(await panel.getByRole('button', { name: '从列表选择模型', exact: true }).count(), 0, 'key edits clear old models');
  await fetchAndOpen(); await page.keyboard.press('Escape');
  await panel.getByRole('combobox', { name: '接口格式', exact: true }).click();
  await page.getByRole('option', { name: 'Gemini Native', exact: true }).click();
  assert.equal(await panel.getByRole('button', { name: '从列表选择模型', exact: true }).count(), 0, 'format edits clear old models');

  for (const [width, height] of [[1544, 900], [910, 512]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => window.dispatchEvent(new StorageEvent('storage', { key: 'mm.theme', newValue: theme })), theme);
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await fetchAndOpen();
      await checkArrow();
      assert.equal(requests.at(-1).apiFormat, 'gemini');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '搜索模型');
      const popup = picker.locator('..');
      const rect = await popup.boundingBox(); const dialogRect = await settings.boundingBox();
      assert(rect.x >= dialogRect.x && rect.x + rect.width <= dialogRect.x + dialogRect.width + 1);
      assert(rect.y >= dialogRect.y && rect.y + rect.height <= dialogRect.y + dialogRect.height + 1);
      const list = picker.locator('[cmdk-list]');
      await list.hover(); await page.mouse.wheel(0, 600);
      await page.waitForFunction(() => document.querySelector('[cmdk-list]')?.scrollTop > 0);
      await page.screenshot({ path: `${out}/${width}-${theme}.png`, animations: 'disabled' });
      await page.keyboard.press('Escape');
      await picker.waitFor({ state: 'detached' }); assert(await settings.isVisible());
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '从列表选择模型');
    }
  }
  await panel.getByRole('button', { name: '保存', exact: true }).click();
  await panel.getByText('已保存', { exact: true }).waitFor();
  assert.equal(saves.at(-1).model, 'custom-model');
  assert.deepEqual(errors, []);
  console.log('PASS: draft discovery, searchable keyboard selection, manual IDs, empty/error/retry, stale cancellation, invalidation, no-save side effects, modal Escape/focus/wheel and light/dark/compact layout.');
} finally { release?.(); await browser.close(); }
