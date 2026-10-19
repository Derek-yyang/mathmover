import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Fixtures only: no real config writes, endpoint probes or CLI invocation.
const out = 'spike-out/byok-load-retry';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 910, height: 640 } });
page.setDefaultTimeout(15_000);
const errors = [];
let reads = 0, writes = 0, releaseRead;
let heldReads = [];
let mode = 'fail';
const config = { baseUrl: 'https://retry.fixture.invalid/v1', model: 'retry-model', apiKeyConfigured: true, apiKeyTail: '1234' };
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => {
  assert.equal(route.request().method(), 'GET', 'no endpoint test or generation');
  return route.fulfill({ json: { runtimes: [] } });
});
await page.route('**/api/byok', async route => {
  if (route.request().method() !== 'GET') {
    writes++;
    return route.fulfill({ status: 503, json: { error: 'fixture save failure' } });
  }
  reads++;
  const requestMode = mode;
  if (requestMode === 'hold') await new Promise(resolve => {
    heldReads.push(resolve);
    const pending = heldReads;
    releaseRead = () => pending.splice(0).forEach(release => release());
  });
  await route.fulfill(requestMode === 'fail'
    ? { status: 503, json: { error: 'fixture read failure' } }
    : { json: config }).catch(() => {});
});
await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [], bindingToken: 'fixture', capabilities: { archive: true, permanentDelete: true } } }));
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await stubConstructionDraft(page);
const panel = page.getByRole('tabpanel', { name: '模型 API', exact: true });
const retry = panel.getByRole('button', { name: '重试', exact: true });
const endpoint = panel.getByRole('textbox', { name: 'API 端点', exact: true });
const model = panel.getByRole('textbox', { name: '模型', exact: true });
const key = panel.locator('input[type=password]');
const test = panel.getByRole('button', { name: /^测试 / });
const save = panel.getByRole('button', { name: '保存', exact: true });
const open = async () => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '模型 API', exact: true }).click();
};
const waitRead = async () => {
  for (let i = 0; i < 200 && !releaseRead; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert(releaseRead, 'held read arrived');
};
try {
  await page.goto(`${process.argv[2] || 'http://localhost:3000'}/dashboard?action=new`, { timeout: 60_000 });
  await open();
  await retry.waitFor();
  const initialReads = reads; // Development Strict Mode may replay the mount effect.
  assert(await endpoint.isDisabled()); assert(await test.isDisabled()); assert(await save.isDisabled());
  await page.screenshot({ path: `${out}/failed.png` });
  await retry.click();
  await retry.waitFor();
  assert.equal(reads, initialReads + 1, 'repeated failures remain retryable');
  mode = 'hold'; releaseRead = undefined;
  await retry.click();
  await waitRead();
  await panel.getByText('正在读取配置…', { exact: true }).waitFor();
  assert.equal(await retry.count(), 0, 'no duplicate retry while loading');
  assert.equal(await panel.getByRole('alert').count(), 0, 'obsolete error cleared');
  assert(await endpoint.isDisabled()); assert(await model.isDisabled()); assert(await key.isDisabled());
  assert(await test.isDisabled()); assert(await save.isDisabled());
  releaseRead();
  await page.waitForFunction(() => document.querySelector('#settings-panel-providers input[type=url]')?.value === 'https://retry.fixture.invalid/v1');
  assert(await endpoint.isEnabled()); assert(await save.isEnabled()); assert(await test.isEnabled());
  assert.equal(await model.inputValue(), config.model);
  assert.equal(await key.inputValue(), '', 'stored credential stays masked');
  assert.equal(await retry.count(), 0); assert.equal(await panel.getByRole('alert').count(), 0);
  assert.equal(reads, initialReads + 2); assert.equal(writes, 0);
  await endpoint.fill('https://draft.fixture.invalid/v1');
  await save.click();
  await panel.getByRole('alert').filter({ hasText: '保存 BYOK 配置失败' }).waitFor();
  assert.equal(await retry.count(), 0, 'save failures cannot reload over a draft');
  assert.equal(await endpoint.inputValue(), 'https://draft.fixture.invalid/v1');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '放弃并关闭', exact: true }).click();
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor({ state: 'detached' });

  // A late response from a closed Settings instance cannot overwrite a new one.
  releaseRead = undefined; heldReads = [];
  await open(); await waitRead();
  const releaseOld = releaseRead;
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor({ state: 'detached' });
  mode = 'success';
  await open();
  await endpoint.waitFor();
  await page.waitForFunction(() => document.querySelector('#settings-panel-providers input[type=url]')?.value === 'https://retry.fixture.invalid/v1');
  await endpoint.fill('https://new-draft.fixture.invalid/v1');
  releaseOld();
  await page.waitForTimeout(200);
  assert.equal(await endpoint.inputValue(), 'https://new-draft.fixture.invalid/v1');
  assert.equal(writes, 1);
  await page.screenshot({ path: `${out}/loaded.png` });
  assert.deepEqual(errors, []);
  console.log('PASS: repeated load failures retry inline; pending loads block duplicate retries; success restores editing; save failures preserve drafts; late responses after close are ignored.');
} finally { await browser.close(); }
