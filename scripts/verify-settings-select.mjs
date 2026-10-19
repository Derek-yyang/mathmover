import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const out = 'spike-out/settings-select';
await mkdir(out, { recursive: true });
const efforts = [{ id: 'low', label: '低' }, { id: 'high', label: '高', default: true }];
const models = [{ id: 'default', label: 'Sonnet → claude-sonnet-5[1M]', reasoningOptions: efforts },
  ...Array.from({ length: 24 }, (_, index) => ({ id: `model-${index}`, label: `Model ${String(index).padStart(2, '0')}`, reasoningOptions: efforts })),
  { id: 'long', label: `Long model → ${'long-model-identifier-'.repeat(9)}`, reasoningOptions: efforts },
  { id: 'plain', label: 'Without reasoning' },
];
const runtimes = [
  { id: 'claude-code', name: 'Claude Code', version: '2.1.300', usable: true, authStatus: 'ok', models: { source: 'live', list: models } },
  { id: 'codex', name: 'Codex', version: '0.162.1', usable: true, authStatus: 'ok', models: { source: 'live', list: [] } },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1544, height: 900 } });
const errors = [];
page.setDefaultTimeout(10_000);
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes } }));
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [], bindingToken: 'fixture' } }));
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await stubConstructionDraft(page);
try {
  await page.goto('http://localhost:3000/dashboard?action=new');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('tab', { name: /^本机 Agent/ }).click();
  const model = dialog.getByRole('combobox', { name: '选择模型', exact: true });
  const effort = dialog.getByRole('combobox', { name: '选择推理档位', exact: true });
  await model.waitFor();
  await model.click();
  const list = page.getByRole('listbox');
  await list.waitFor();
  assert(await list.evaluate(el => !!el.closest('[data-slot=settings-dialog]')), 'list stays in Settings focus scope');
  assert.equal(await list.getByRole('option', { selected: true }).innerText(), models[0].label);
  await page.keyboard.press('Escape');
  assert(await dialog.isVisible(), 'Escape dismisses only the select');
  assert(await model.evaluate(el => document.activeElement === el), 'dismissal restores trigger focus');
  await model.press('ArrowDown');
  await list.waitFor();
  await page.keyboard.press('Home');
  await page.waitForFunction(label => document.activeElement?.textContent === label, models[0].label);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement?.textContent === 'Model 00');
  await page.keyboard.press('Enter');
  await model.filter({ hasText: 'Model 00' }).waitFor();
  assert.match(await model.innerText(), /Model 00/);
  assert(await model.evaluate(el => document.activeElement === el));
  await effort.click();
  await list.getByRole('option', { name: '低', exact: true }).click();
  assert.equal((await effort.innerText()).trim(), '低');
  // Modal correctly hides the composer behind it from the accessibility tree.
  assert.match(await page.getByRole('button', { name: /^选择模型与推理档位/, includeHidden: true }).getAttribute('aria-label'), /Model 00.*低/);
  await model.click();
  await page.keyboard.type('Without');
  await page.waitForFunction(() => document.activeElement?.textContent === 'Without reasoning');
  await page.keyboard.press('Enter');
  await dialog.getByText('由 Agent 配置决定', { exact: true }).waitFor();
  assert.equal(await effort.count(), 0);
  await model.click();
  await page.keyboard.press('Home');
  await page.waitForFunction(label => document.activeElement?.textContent === label, models[0].label);
  await page.keyboard.press('Enter');
  await effort.waitFor();
  assert.equal((await effort.innerText()).trim(), '高', 'each model keeps its own effort/default');

  for (const viewport of [{ width: 1544, height: 900 }, { width: 1024, height: 640 }]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => window.dispatchEvent(new StorageEvent('storage', { key: 'mm.theme', newValue: theme })), theme);
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await model.click();
      await list.waitFor();
      await page.waitForTimeout(200);
      const bounds = await list.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1, 'menu stays in viewport');
      const dialogBounds = await dialog.boundingBox();
      assert(bounds.x >= dialogBounds.x && bounds.y >= dialogBounds.y && bounds.x + bounds.width <= dialogBounds.x + dialogBounds.width + 1 && bounds.y + bounds.height <= dialogBounds.y + dialogBounds.height + 1, 'Settings does not clip the menu');
      assert(await list.evaluate(el => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), 'menu receives pointer input above Settings');
      await dialog.screenshot({ path: `${out}/${viewport.width}-${theme}.png` });
      const scroll = list.locator('[data-radix-select-viewport]');
      const before = await scroll.evaluate(el => el.scrollTop);
      await list.hover();
      await page.mouse.wheel(0, 350);
      await page.waitForTimeout(120);
      assert(await scroll.evaluate((el, before) => el.scrollTop > before, before), 'wheel scrolls long list');
      // Stop hover focus changes as keyboard navigation scrolls different items
      // under the pointer; verify keyboard focus separately from pointer movement.
      await page.mouse.move(0, 0);
      await page.keyboard.press('End');
      await page.waitForFunction(() => document.activeElement?.textContent === 'Without reasoning');
      await page.keyboard.press('ArrowUp');
      await page.waitForFunction(label => document.activeElement?.textContent === label, models.at(-2).label);
      await page.keyboard.press('Enter');
      assert.match(await model.innerText(), /Long model/);
      assert(await model.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'long selected label does not widen trigger');
      await model.click();
      await list.waitFor();
      await page.waitForTimeout(200);
      assert(await list.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'long label does not overflow list');
      await dialog.screenshot({ path: `${out}/${viewport.width}-${theme}-long.png` });
      await page.keyboard.press('Home');
      await page.waitForFunction(label => document.activeElement?.textContent === label, models[0].label);
      await page.keyboard.press('Enter');
      const headingBounds = await dialog.locator('#settings-title').boundingBox();
      await effort.click();
      await list.waitFor();
      await page.mouse.click(headingBounds.x + 10, headingBounds.y + 10);
      await list.waitFor({ state: 'hidden' });
      assert.equal(await list.count(), 0, 'outside click dismisses select');
      assert(await dialog.isVisible());
    }
  }
  await dialog.getByRole('button', { name: '使用 Codex', exact: true }).click();
  assert(await model.isDisabled(), 'empty model list disables select');
  assert.match(await model.innerText(), /暂无可选模型/);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('PASS: pointer/keyboard/typeahead selection, shared model/effort state, focus/Escape, wheel, long/empty lists, light/dark and narrow viewport.');
} catch (error) {
  console.error(await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 600), lists: [...document.querySelectorAll('[role=listbox]')].map(el => el.outerHTML.slice(0, 600)) })).catch(() => 'Page context unavailable'));
  await page.screenshot({ path: `${out}/failure.png` });
  throw error;
} finally { await browser.close(); }
