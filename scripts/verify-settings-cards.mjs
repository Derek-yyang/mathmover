import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// 设置卡片重构（2026-10-13 评审后）的验收：双 Tab、卡片信息设计（模型一眼可见）、
// 状态芯片、连接测试、设置与聊天区共写同一份模型状态、BYOK 归位 模型 API Tab。
// agent 检测走真实接口（真版本/真芯片）；仅 /api/agent/test 打桩（避免真跑 CLI 探测）。
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1544, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const chip = () => page.locator('li .rounded-full', { hasText: /已登录|未登录|起不来|已安装|已配置|未配置/ });
const openSettings = async () => {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.getByRole('button', { name: '设置', exact: true }).click({ timeout: 2_000 }).catch(() => {});
    if (await page.getByRole('tab', { name: /^本机 Agent/ }).count()) return;
    await page.waitForTimeout(500);
  }
  throw new Error('设置弹窗未打开');
};

try {
  await page.route('**/api/coursewares**', (route) => route.fulfill({ json: { records: [] } }));
  await page.route('**/api/byok', (route) => route.fulfill({ json: {
    baseUrl: 'https://fixture.invalid/v1', model: 'fixture-model', apiKeyConfigured: false, apiKeyTail: '',
  } }));
  await page.route('**/api/agent/test', (route) => route.fulfill({ json: { ok: true, status: 'ready', message: '就绪 · 已登录（验收桩）' } }));
  await stubConstructionDraft(page);
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('textbox', { name: '题目描述' }).waitFor({ timeout: 60_000 });

  await openSettings();

  // 0. 左侧分区导航壳 + 品牌图标
  const nav = page.getByRole('navigation', { name: '设置分区' });
  await nav.getByRole('button', { name: '模型与提供商', exact: true }).waitFor();
  await nav.getByRole('button', { name: '帮助与快捷键', exact: true }).waitFor();
  await nav.getByRole('button', { name: '关于', exact: true }).waitFor();

  // 1. 双 Tab：默认「模型 API」，本机 Agent 在右侧且不含 BYOK
  const cliTab = page.getByRole('tab', { name: /^本机 Agent/ });
  const providerTab = page.getByRole('tab', { name: '模型 API', exact: true });
  await cliTab.waitFor();
  assert.equal(await providerTab.getAttribute('aria-selected'), 'true', 'model API tab active by default');
  await cliTab.click();
  assert.equal(await page.getByRole('heading', { name: '内置 Agent' }).count(), 0, 'BYOK lives in the provider tab, not the CLI list');

  // 2. 卡片信息设计：名称 + 官方来源副标题 + 版本 + 状态芯片 + 测试/使用
  await page.getByText('Anthropic 官方 CLI').first().waitFor();
  await page.getByText('OpenAI 官方 CLI').first().waitFor();
  assert.ok(await page.locator('[data-brand-icon]').count() >= 2, 'brand marks rendered on cards');
  assert.ok(await chip().count() >= 2, 'status chips rendered');
  await page.getByRole('button', { name: '测试 Claude Code' }).waitFor();

  // 3. 模型一眼可见：非选中卡也有「模型 …」行
  const glance = page.locator('li p', { hasText: /^模型 / });
  assert.ok(await glance.count() >= 1, 'model-at-a-glance on non-selected cards');

  // 4. 选中卡：模型/档位行内可改，且与聊天区 composer 写同一份状态
  // 锚定 /^使用 / 排除「当前使用」；点任意一张可选卡即可（都是真数据）
  await page.getByRole('button', { name: /^使用 / }).first().click();
  const composerTrigger = page.getByRole('button', { name: /^选择模型与推理档位/ });
  const before = (await composerTrigger.getAttribute('aria-label'));
  const modelSelect = page.getByRole('combobox', { name: '选择模型' });
  await modelSelect.waitFor();
  const selectedCard = page.locator('li').filter({ has: modelSelect });
  const currentIndicator = selectedCard.locator('span[aria-label^="当前使用 "]');
  assert.equal(await currentIndicator.evaluate(element => getComputedStyle(element).opacity), '1', 'current usage is a full-opacity status, not a disabled button');
  const configurationHelp = selectedCard.locator('details');
  assert.equal(await configurationHelp.evaluate(element => element.open), false, 'configuration help starts collapsed for a usable, signed-in Agent');
  const collapsedHeight = (await selectedCard.boundingBox()).height;
  await configurationHelp.locator('summary').click();
  await selectedCard.getByRole('link', { name: /配置文档/ }).waitFor();
  const expandedHeight = (await selectedCard.boundingBox()).height;
  assert(expandedHeight > collapsedHeight, 'folding help reduces card height');
  await configurationHelp.locator('summary').click();
  const scrollbar = page.locator('.settings-scroll-viewport');
  const scrollbarStyle = await scrollbar.evaluate(element => ({
    width: getComputedStyle(element, '::-webkit-scrollbar').width,
    buttons: getComputedStyle(element, '::-webkit-scrollbar-button').display,
  }));
  assert.deepEqual(scrollbarStyle, { width: '6px', buttons: 'none' });
  await modelSelect.click();
  const options = await page.getByRole('listbox').getByRole('option').all();
  assert.ok(options.length >= 2, 'model select populated');
  await options[1].click();
  await page.waitForTimeout(300);
  const after = (await composerTrigger.getAttribute('aria-label'));
  assert.notEqual(before, after, 'settings model select writes the same state as the composer picker');
  // 档位行：有档位清单出选择器，没有则如实写「由 Agent 配置决定」
  const effortSelect = page.getByRole('combobox', { name: '选择推理档位' });
  const effortText = page.getByText('由 Agent 配置决定', { exact: true });
  assert.ok((await effortSelect.count()) + (await effortText.count()) >= 1, 'effort row present (select or honest fallback)');

  // 5. 连接测试：结果行可见
  await page.getByRole('button', { name: '测试 Claude Code' }).click();
  await page.getByRole('status').filter({ hasText: '就绪 · 已登录（验收桩）' }).first().waitFor({ timeout: 10_000 });

  // 6. 安装向导收进折叠组；全装齐时该组如实不出现
  const installGroup = page.getByText(/^可安装/).first();
  const hasInstallGroup = await installGroup.isVisible().catch(() => false);
  if (hasInstallGroup) {
    assert.ok(!(await page.getByText('点「安装」打开官方安装页').first().isVisible().catch(() => false)),
      'install wizard collapsed when agents are detected');
  }

  // 7. Tab 键盘切换 + BYOK 卡片在 模型 API里（含测试按钮与密钥掩码语义）
  await cliTab.focus();
  await page.keyboard.press('Home');
  await page.getByRole('heading', { name: '内置 Agent' }).waitFor();
  await page.getByRole('button', { name: '测试 内置 Agent' }).waitFor();
  const providerPanel = page.getByRole('tabpanel', { name: '模型 API' });
  const endpointInput = providerPanel.getByRole('textbox', { name: 'API 端点', exact: true });
  await page.waitForFunction(() => document.querySelector('#settings-panel-providers input[type=url]')?.value === 'https://fixture.invalid/v1');
  await page.getByRole('button', { name: '测试 内置 Agent' }).click();
  await providerPanel.getByRole('status').filter({ hasText: '就绪 · 已登录（验收桩）' }).waitFor();
  await endpointInput.fill('https://draft.invalid/v1');
  await providerPanel.getByRole('textbox', { name: '模型', exact: true }).fill('draft-model');
  await providerPanel.getByLabel('API 密钥（本地端点可留空）', { exact: true }).fill('fixture-draft-key');
  assert(await page.getByRole('button', { name: '测试 内置 Agent' }).isDisabled(), 'unsaved configuration cannot be tested');
  await providerPanel.getByText('配置已修改，请先保存再测试。', { exact: true }).waitFor();
  assert.equal(await providerPanel.getByRole('status').filter({ hasText: '就绪 · 已登录（验收桩）' }).count(), 0, 'editing clears the old test result');

  // 8. 分区导航：帮助与快捷键 / 关于 各有真实内容，返回后 Tab 仍在
  await nav.getByRole('button', { name: '帮助与快捷键', exact: true }).click();
  await page.getByText('工作台的实际交互行为速查').waitFor();
  await nav.getByRole('button', { name: '关于', exact: true }).click();
  await page.getByText('数据与密钥', { exact: true }).first().waitFor();
  await nav.getByRole('button', { name: '模型与提供商', exact: true }).click();
  await page.getByRole('tab', { name: '模型 API', exact: true }).waitFor();
  assert.equal(await endpointInput.inputValue(), 'https://draft.invalid/v1', 'section switching retains unsaved endpoint');
  assert.equal(await providerPanel.getByRole('textbox', { name: '模型', exact: true }).inputValue(), 'draft-model', 'section switching retains unsaved model');
  assert.equal(await providerPanel.getByLabel('API 密钥（本地端点可留空）', { exact: true }).inputValue(), 'fixture-draft-key', 'section switching retains unsaved key');
  await providerPanel.getByText('配置已修改，请先保存再测试。', { exact: true }).waitFor();

  await mkdir(new URL('../spike-out/verify-settings/', import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL('../spike-out/verify-settings/providers-tab.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await page.getByRole('tab', { name: /^本机 Agent/ }).click();
  await page.getByRole('tabpanel', { name: /^本机 Agent/ }).getByRole('status').filter({ hasText: '就绪 · 已登录（验收桩）' }).waitFor();
  await page.waitForTimeout(300);   // 等边框过渡收尾，避免截到中间帧
  await page.screenshot({ path: new URL('../spike-out/verify-settings/cli-tab.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });

  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ navShell: true, brandIcons: true, dualTabs: true, byokInProviderTab: true, cardSubtitles: true, statusChips: true,
    modelAtAGlance: true, sharedModelState: true, effortRow: true, testButton: true,
    installCollapsed: true, tabKeyboard: true, configurationHelpCollapsed: true, currentStatusLegible: true,
    thinScrollbar: true, sectionDraftsRetained: true, editedTestResultsCleared: true,
    cardHeights: { collapsed: collapsedHeight, expanded: expandedHeight }, browserErrors: errors.length }));
} finally {
  await browser.close();
}
