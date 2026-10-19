import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Browser checks against isolated fixtures: never runs CLI tools or writes real config.
const out = 'spike-out/settings-controls';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1544, height: 900 } });
page.setDefaultTimeout(10_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const models = { source: 'live', list: [{ id: 'default', label: 'Sonnet', reasoningOptions: [{ id: 'high', label: '高' }] }] };
const runtimes = [
  { id: 'claude-code', name: 'Claude Code', version: '2.1.300', usable: true, authStatus: 'ok', models },
  { id: 'codex', name: 'Codex', version: '0.162.1', usable: true, authStatus: 'missing', models },
  { id: 'dsh', name: 'DeepSeek Harness', version: '0.1.1-rc.1', usable: true, authStatus: 'unknown', models },
  { id: 'byok', name: '内置 Agent（OpenCode）', version: null, usable: true },
];
let releaseTest, releaseDetection;
await page.route('**/api/agent**', async route => {
  if (route.request().method() === 'POST') {
    assert.equal(new URL(route.request().url()).pathname, '/api/agent/test');
    await new Promise(resolve => { releaseTest = resolve; });
    return route.fulfill({ json: { ok: true, message: '连接测试成功（验收桩）' } });
  }
  if (new URL(route.request().url()).searchParams.has('fresh')) await new Promise(resolve => { releaseDetection = resolve; });
  return route.fulfill({ json: { runtimes } });
});
await page.route('**/api/byok', route => {
  assert.equal(route.request().method(), 'GET', 'draft edits never save automatically');
  return route.fulfill({ json: { baseUrl: 'https://fixture.invalid/v1', model: 'fixture-model', apiKeyConfigured: true, apiKeyTail: '1234' } });
});
await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [], bindingToken: 'fixture' } }));
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await stubConstructionDraft(page);
try {
  await page.goto('http://localhost:3000/dashboard?action=new', { timeout: 60_000 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const cliTab = dialog.getByRole('tab', { name: /^本机 Agent/ });
  const apiTab = dialog.getByRole('tab', { name: '模型 API', exact: true });
  const cli = dialog.locator('#settings-panel-cli');
  const api = dialog.locator('#settings-panel-providers');
  const nav = dialog.getByRole('navigation', { name: '设置分区' });
  await api.waitFor({ state: 'visible' });
  assert.equal(await apiTab.getAttribute('aria-selected'), 'true', 'model API is the default tab');
  assert((await apiTab.boundingBox()).x < (await cliTab.boundingBox()).x, 'model API comes first visually');
  await apiTab.focus();
  await apiTab.press('End');
  await cli.waitFor({ state: 'visible' });
  assert(await cliTab.evaluate(el => el === document.activeElement));
  await cliTab.focus();
  await cliTab.press('Home');
  await api.waitFor({ state: 'visible' });
  assert.equal(await apiTab.getAttribute('aria-selected'), 'true');
  assert(await apiTab.evaluate(el => el === document.activeElement));
  assert.equal(await cliTab.getAttribute('tabindex'), '-1');
  assert.equal(await dialog.getByRole('tabpanel').count(), 1, 'only active panel is exposed');
  const endpoint = api.getByRole('textbox', { name: 'API 端点', exact: true });
  await endpoint.fill('https://draft.invalid/v1');
  await api.getByRole('textbox', { name: '模型', exact: true }).fill('draft-model');
  await apiTab.focus();
  await apiTab.press('End');
  await cli.waitFor({ state: 'visible' });
  assert(await cliTab.evaluate(el => el === document.activeElement));
  await cliTab.press('ArrowLeft');
  await api.waitFor({ state: 'visible' });
  assert.equal(await endpoint.inputValue(), 'https://draft.invalid/v1');
  await apiTab.press('ArrowRight');
  await cli.waitFor({ state: 'visible' });

  const test = cli.getByRole('button', { name: '测试 Claude Code', exact: true });
  await test.click();
  await test.filter({ hasText: '测试中…' }).waitFor();
  assert(await test.isDisabled());
  assert.equal(await test.getAttribute('aria-busy'), 'true');
  await page.waitForTimeout(50);
  assert(releaseTest, 'test request was made');
  releaseTest();
  const result = cli.getByRole('status').filter({ hasText: '连接测试成功（验收桩）' });
  await result.waitFor();
  await apiTab.click();
  await nav.getByRole('button', { name: '帮助与快捷键', exact: true }).click();
  assert.equal(await dialog.getByRole('tab').count(), 0, 'other sections hide both tab controls and panels');
  await nav.getByRole('button', { name: '模型与提供商', exact: true }).click();
  assert.equal(await endpoint.inputValue(), 'https://draft.invalid/v1');
  assert.equal(await api.getByRole('textbox', { name: '模型', exact: true }).inputValue(), 'draft-model');
  await cliTab.click();
  await result.waitFor();

  const refresh = dialog.getByRole('button', { name: '刷新检测', exact: true });
  await refresh.click();
  await refresh.filter({ hasText: '正在检测…' }).waitFor();
  assert(await refresh.isDisabled());
  assert.equal(await refresh.getAttribute('aria-busy'), 'true');
  assert(await test.isDisabled());
  assert(await cli.getByRole('button', { name: '使用 Codex', exact: true }).isDisabled());
  assert(releaseDetection, 'refresh request was made');
  releaseDetection();
  await refresh.filter({ hasText: '刷新检测' }).waitFor();
  assert(await test.isEnabled());

  for (const width of [1544, 1024]) {
    await page.setViewportSize({ width, height: width === 1024 ? 640 : 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => window.dispatchEvent(new StorageEvent('storage', { key: 'mm.theme', newValue: theme })), theme);
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      for (const [name, tab, panel] of [['cli', cliTab, cli], ['api', apiTab, api]]) {
        await tab.click();
        const sizes = await dialog.evaluate(el => ({
          actions: [...el.querySelectorAll('button[aria-label="刷新检测"], [role=tabpanel]:not([hidden]) button[aria-label^="测试 "], [role=tabpanel]:not([hidden]) button[aria-label^="使用 "]')].map(button => button.getBoundingClientRect().height),
          badges: [...el.querySelectorAll('[role=tabpanel]:not([hidden]) [data-slot=badge]')].map(badge => badge.getBoundingClientRect().height),
          badgeColors: [...el.querySelectorAll('[role=tabpanel]:not([hidden]) [data-slot=badge]')].map(badge => ({
            color: getComputedStyle(badge).color, background: getComputedStyle(badge).backgroundColor,
          })),
        }));
        assert(sizes.actions.every(height => height === 32), JSON.stringify(sizes));
        assert(sizes.badges.every(height => height === 20), JSON.stringify(sizes));
        const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
          .map(channel => channel / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
          .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
        for (const { color, background } of sizes.badgeColors) {
          const foregroundLuminance = luminance(color), backgroundLuminance = luminance(background);
          assert((Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05) >= 4.5, 'badge text has accessible contrast');
        }
        assert(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'panel has no horizontal overflow');
        await dialog.screenshot({ path: `${out}/${width}-${theme}-${name}.png` });
      }
    }
  }
  // Finish this draft-preservation scenario by reverting it before close tests.
  await endpoint.fill('https://fixture.invalid/v1');
  await api.getByRole('textbox', { name: '模型', exact: true }).fill('fixture-model');
  // Dialog owns the focus loop; tabbing must never enter the page behind it.
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < 35; index++) {
      await page.keyboard.press(key);
      assert(await dialog.evaluate(el => el.contains(document.activeElement)), `${key} stays inside Settings`);
    }
  }
  const settingsTrigger = page.getByRole('button', { name: '设置', exact: true });
  async function expectClosed() {
    await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '设置');
    assert(await settingsTrigger.evaluate(el => el === document.activeElement));
  }
  await cliTab.click();
  const model = dialog.getByRole('combobox', { name: '选择模型', exact: true });
  await model.click();
  await page.getByRole('listbox').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('listbox').waitFor({ state: 'detached' });
  assert(await dialog.isVisible(), 'first Escape closes select only');
  await page.keyboard.press('Escape');
  await expectClosed();

  await settingsTrigger.click();
  await dialog.waitFor();
  await nav.getByRole('button', { name: '外观', exact: true }).click();
  const theme = dialog.getByRole('button', { name: /^主题模式/ });
  await theme.click();
  await page.getByRole('menu').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({ state: 'detached' });
  assert(await dialog.isVisible(), 'theme menu Escape retains Settings');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-labelledby')?.includes('theme-mode-label'));
  await page.mouse.click(5, 300);
  await expectClosed();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settingsTrigger.click();
  await dialog.waitFor();
  assert.equal(await dialog.evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await dialog.evaluate(el => getComputedStyle(el).borderRadius), '12px');
  assert.equal(await dialog.getByRole('button', { name: '关闭设置', exact: true }).count(), 1);
  await dialog.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expectClosed();
  assert.deepEqual(errors, []);
  console.log('PASS: official tabs, drafts/results, busy guards, light/dark/narrow layout, modal focus loop, nested select/theme Escape, backdrop/close/reopen, reduced motion and focus restore.');
} finally {
  releaseTest?.(); releaseDetection?.();
  await browser.close();
}
