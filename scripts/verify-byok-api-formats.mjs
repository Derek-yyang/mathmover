import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Isolated settings fixture: never writes actual config or invokes any model.
const out = 'spike-out/byok-api-formats';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1544, height: 900 } });
page.setDefaultTimeout(15_000);
let config = { baseUrl: 'https://fixture.invalid/v1', model: 'fixture-model', apiKeyConfigured: true, apiKeyTail: '1234' };
const errors = [], saves = [], tests = [];
let saveFail = false, holdTest = false, releaseTest;
page.on('pageerror', e => errors.push(e.message));
await page.route('**/api/agent**', async route => {
  if (route.request().method() === 'GET') return route.fulfill({ json: { runtimes: [] } });
  assert.equal(new URL(route.request().url()).pathname, '/api/agent/test');
  assert.deepEqual(route.request().postDataJSON(), { runtimeId: 'byok' });
  tests.push(config.apiFormat);
  if (holdTest) await new Promise(resolve => { releaseTest = resolve; });
  return route.fulfill({ json: { ok: true, message: 'fixture-protocol-result' } }).catch(() => {});
});
await page.route('**/api/byok', route => {
  if (route.request().method() === 'GET') return route.fulfill({ json: config });
  const body = route.request().postDataJSON();
  saves.push(body);
  if (saveFail) return route.fulfill({ status: 503, json: { error: 'fixture' } });
  assert.equal(body.apiKey, '', 'protocol switch preserves the stored key');
  config = { ...config, apiFormat: body.apiFormat, baseUrl: body.baseUrl.trim(), model: body.model.trim() };
  return route.fulfill({ json: config });
});
await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [], bindingToken: 'fixture' } }));
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await stubConstructionDraft(page);
const settings = page.getByRole('dialog', { name: '设置', exact: true });
const panel = page.getByRole('tabpanel', { name: '模型 API', exact: true });
const format = panel.getByRole('combobox', { name: '接口格式', exact: true });
const endpoint = panel.getByRole('textbox', { name: 'API 端点', exact: true });
const test = panel.getByRole('button', { name: '测试 内置 Agent', exact: true });
const save = panel.getByRole('button', { name: '保存', exact: true });
const open = async () => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '模型 API', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#settings-panel-providers [role=combobox]')?.disabled);
};
const select = async label => {
  await format.click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.getByRole('listbox').waitFor({ state: 'detached' });
};
try {
  await page.goto('http://localhost:3000/dashboard?action=new', { timeout: 60_000 });
  await open();
  assert.equal(await format.textContent(), 'OpenAI Chat Completions', 'legacy config defaults correctly');
  await format.click();
  assert.equal(await page.getByRole('option').count(), 4);
  await page.keyboard.press('End');
  await page.getByRole('option', { name: 'Gemini Native', exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent === 'Gemini Native');
  await page.keyboard.press('Enter');
  await page.getByRole('listbox').waitFor({ state: 'detached' });
  assert.equal(await format.textContent(), 'Gemini Native');
  assert.equal(await endpoint.inputValue(), config.baseUrl, 'switching protocol does not rewrite user endpoint');
  assert(await test.isDisabled());
  await page.getByText('配置已修改，请先保存再测试。', { exact: true }).waitFor();
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByText('放弃未保存的修改？', { exact: true }).waitFor();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await format.textContent(), 'Gemini Native');
  await select('OpenAI Chat Completions');
  assert(await test.isEnabled(), 'reverting format clears dirty state');
  await select('Anthropic Messages');
  saveFail = true; await save.click();
  await panel.getByRole('alert').waitFor();
  assert.equal(await format.textContent(), 'Anthropic Messages');
  assert(await test.isDisabled());
  saveFail = false; await save.click();
  await panel.getByText('已保存', { exact: true }).waitFor();
  assert.equal(config.apiFormat, 'anthropic');
  holdTest = true; await test.click();
  await panel.getByText('测试中…', { exact: true }).waitFor();
  for (let i = 0; i < 100 && !releaseTest; i++) await page.waitForTimeout(20);
  assert(releaseTest);
  await select('OpenAI Responses');
  holdTest = false; releaseTest();
  await page.waitForTimeout(100);
  assert.equal(await panel.getByText('测试结果：fixture-protocol-result', { exact: true }).count(), 0, 'format changes invalidate in-flight tests');

  for (const [id, label] of [['openai-responses', 'OpenAI Responses'], ['gemini', 'Gemini Native'], ['openai-chat', 'OpenAI Chat Completions']]) {
    await select(label);
    await save.click(); await panel.getByText('已保存', { exact: true }).waitFor();
    assert.equal(config.apiFormat, id);
    await test.click();
    await panel.getByText('测试结果：fixture-protocol-result', { exact: true }).waitFor();
    assert.equal(tests.at(-1), id, 'testing uses the persisted format');
  }
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await settings.waitFor({ state: 'detached' });
  await open(); assert.equal(await format.textContent(), 'OpenAI Chat Completions');
  for (const [width, height] of [[1544, 900], [910, 512]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => window.dispatchEvent(new StorageEvent('storage', { key: 'mm.theme', newValue: theme })), theme);
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await format.click();
      const list = page.getByRole('listbox');
      await list.waitFor();
      const bounds = await list.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1);
      await page.screenshot({ path: `${out}/${width}-${theme}.png`, animations: 'disabled' });
      await page.keyboard.press('Escape');
      await list.waitFor({ state: 'detached' });
      assert(await settings.isVisible(), 'Escape dismisses only the protocol list');
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '接口格式');
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: four official Select options, legacy default, keyboard/Escape/focus, unsaved-close guard, save failures, persistence, test invalidation and light/dark/compact menus.');
} finally { releaseTest?.(); await browser.close(); }
