import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Isolated API fixtures: no Agent calls, key changes or courseware writes.
const base = process.argv[2] ?? 'http://localhost:3000';
const options = ['low', 'medium', 'high', 'xhigh', 'max'].map(id => ({ id, label: id, default: id === 'medium' }));
const localized = ['低', '中', '高'].map((label, index) => ({ id: String(index), label, default: index === 1 }));
const runtime = { id: 'claude-code', name: 'Claude Code', version: 'fixture', usable: true, authStatus: 'ok',
  canAttachImages: true, models: { source: 'live', list: [
    { id: 'default', label: '默认（用 CLI 自己的配置）', reasoningOptions: options },
    { id: 'localized', label: '中文档位模型', reasoningOptions: localized },
  ] } };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1544, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [], ok: true } }));
  await page.route('**/api/agent**', route => {
    assert.equal(route.request().method(), 'GET', 'never invoke the Agent');
    return route.fulfill({ json: { runtimes: [runtime] } });
  });
  await stubConstructionDraft(page);
  await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
  const trigger = page.getByRole('button', { name: /^选择模型与推理档位/ });
  await trigger.click();
  const track = page.getByRole('radiogroup', { name: /^推理档位/ });
  await track.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const geometry = () => track.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, width: bounds.width, dots: [...element.querySelectorAll('[role=radio]')].map(button => {
      const rect = button.getBoundingClientRect();
      return { center: rect.x + rect.width / 2, width: rect.width };
    }) };
  });
  const initial = await geometry();
  const compare = (actual, expected) => {
    assert(Math.abs(actual.x - expected.x) < 0.5, 'track position must stay stable');
    assert(Math.abs(actual.width - expected.width) < 0.5, 'track width must stay stable');
    assert.equal(actual.dots.length, expected.dots.length);
    for (let index = 0; index < actual.dots.length; index++) {
      assert(Math.abs(actual.dots[index].center - expected.dots[index].center) < 0.5, 'dot centers must stay stable');
      assert(Math.abs(actual.dots[index].width - expected.dots[index].width) < 0.5, 'click targets must stay stable');
    }
  };
  for (const option of options) {
    await track.getByRole('radio', { name: option.label, exact: true }).click();
    assert.equal(await track.getByRole('radio', { name: option.label, exact: true }).getAttribute('aria-checked'), 'true');
    assert((await trigger.innerText()).includes(option.label));
    compare(await geometry(), initial);
  }
  const directory = new URL('../spike-out/effort-track-layout/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const screenshotPath = new URL('stable-track.png', directory).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  await page.screenshot({ path: screenshotPath });
  const listbox = page.getByRole('listbox', { name: '模型列表' });
  await listbox.getByRole('option', { name: '中文档位模型', exact: true }).click();
  const localInitial = await geometry();
  assert.equal(localInitial.dots.length, 3, 'changing models still updates the available levels');
  for (const option of localized) {
    await track.getByRole('radio', { name: option.label, exact: true }).click();
    compare(await geometry(), localInitial);
  }
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 700 });
  await trigger.click();
  const panel = await listbox.boundingBox();
  const narrow = await geometry();
  assert(panel.x >= 0 && panel.x + panel.width <= 320, 'panel fits the narrow viewport');
  assert(narrow.width > 0, 'track remains usable in a narrow viewport');
  for (const option of localized) {
    await track.getByRole('radio', { name: option.label, exact: true }).click();
    compare(await geometry(), narrow);
  }
  await track.getByRole('radio', { name: '中', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '高');
  await page.keyboard.press('Enter');
  assert.equal(await track.getByRole('radio', { name: '高', exact: true }).getAttribute('aria-checked'), 'true');
  compare(await geometry(), narrow);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ stableAcrossFiveLevels: true, stableFromDefaultToExplicit: true,
    localizedLabels: true, modelSwitching: true, narrowViewport: true, keyboard: true, trackWidth: initial.width, pageErrors: errors }));
} finally { await browser.close(); }
