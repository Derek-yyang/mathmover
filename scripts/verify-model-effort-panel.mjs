import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// 模型 + 推理档位组合面板的真页面验收：课件接口与 agent 探测都走夹具，不碰真实 CLI。
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1544, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));

const levelSets = {
  rich: [{ id: 'low', label: 'low' }, { id: 'high', label: 'high', default: true }, { id: 'max', label: 'max' }],
  tiny: [{ id: 'off', label: 'off' }, { id: 'on', label: 'on', default: true }],
};
const runtimes = [{
  id: 'claude-code', name: 'Claude Code', version: '2.1.296', usable: true, authStatus: 'ok',
  canAttachImages: true, supportsCustomModel: true,
  models: { source: 'live', list: [
    { id: 'default', label: '默认（用 CLI 自己的配置）', reasoningOptions: levelSets.rich },
    { id: 'opus', label: 'Opus → claude-opus-5[1M]（claude-haiku-5-5）', reasoningOptions: levelSets.rich },
    { id: 'mimo', label: 'mimo-v2.6-pro（config.toml）', reasoningOptions: levelSets.tiny },
    { id: 'bare', label: '裸模型（无档位清单）' },
  ] },
}];

const trigger = () => page.getByRole('button', { name: /^选择模型与推理档位/ });
const listbox = page.getByRole('listbox', { name: '模型列表' });
const radiogroup = page.getByRole('radiogroup', { name: '推理档位' });
const row = name => listbox.getByRole('option', { name: new RegExp(name) });

try {
  await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [] } }));
  await page.route('**/api/agent', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: { ok: true, daemon: 'http://localhost:8788', canvasConnected: false, runtimes, activeRuntime: 'claude-code' } });
  });
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded' });
  await trigger().waitFor();

  // 初始：默认模型 + 默认档位（agent 配置生效值），触发钮成对显示
  assert.match((await trigger().innerText()).replace(/\s+/g, ' '), /默认/, 'trigger shows model name');
  assert.match((await trigger().innerText()).replace(/\s+/g, ' '), /high/, 'trigger shows default effort');

  // 开面板：两行式模型清单 + 点阵档位
  await trigger().click();
  await listbox.waitFor();
  assert.equal(await row('claude-haiku-5-5').count(), 1, 'mapping detail shows on second line');
  await listbox.getByText('来自 config.toml', { exact: true }).waitFor();
  assert.equal(await radiogroup.getByRole('radio').count(), 3, 'rich level set has 3 dots');

  // 选模型不关面板；档位行随模型换档位集
  await row('裸模型').click();
  await listbox.waitFor();
  await page.getByText('推理档位：由 Agent 配置决定', { exact: true }).waitFor();
  assert.ok(!((await trigger().innerText()).replace(/\s+/g, ' ')).includes('·'), 'no effort chip on model without levels');

  await row('mimo-v2.6-pro').click();
  await listbox.waitFor();
  assert.equal(await radiogroup.getByRole('radio').count(), 2, 'level set follows the selected model');
  await mkdir(new URL('../spike-out/model-effort-panel/', import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL('../spike-out/model-effort-panel/panel-open.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });

  // 点档位点阵：选定即关面板，触发钮回显
  await radiogroup.getByRole('radio', { name: 'on' }).click();
  await trigger().waitFor();
  assert.match((await trigger().innerText()).replace(/\s+/g, ' '), /mimo-v2\.6-pro · on/, 'effort chip reflects pinned choice');

  // 键盘：Enter 开面板 → 方向键走模型行 → Enter 选定（不关）→ Tab 进点阵 → 方向键浏览 → Enter 选定关闭
  await trigger().focus();
  await page.keyboard.press('Enter');
  await listbox.waitFor();
  await page.keyboard.press('ArrowUp');            // 焦点从选中行（mimo,2）上移到 opus(1)
  await page.keyboard.press('Enter');            // opus 行
  await listbox.waitFor();
  assert.match((await trigger().innerText()).replace(/\s+/g, ' '), /Opus/, 'keyboard select updates trigger');
  await page.keyboard.press('Tab');               // 焦点进点阵（仅选中点可 tab）
  await page.keyboard.press('ArrowRight');
  const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  assert.equal(focusedLabel, 'max', 'arrow walks the dots without selecting');
  assert.match((await trigger().innerText()).replace(/\s+/g, ' '), /high/, 'walking dots does not change effort');
  await page.keyboard.press('Enter');
  await trigger().waitFor();
  assert.match((await trigger().innerText()).replace(/\s+/g, ' '), /Opus · max/, 'enter pins effort and closes');

  // 每模型记各自的档位：换回 mimo 显示它自己的 on
  await trigger().click();
  await row('mimo-v2.6-pro').click();
  await page.keyboard.press('Escape');
  assert.match((await trigger().innerText()).replace(/\s+/g, ' '), /mimo-v2\.6-pro · on/, 'effort is remembered per model');

  // Esc 关面板不改值
  await trigger().click();
  await row('裸模型').click();
  await page.keyboard.press('Escape');
  assert.match((await trigger().innerText()).replace(/\s+/g, ' '), /裸模型/, 'escape closes without changes');

  // 窄聊天区：面板不超出视口
  await page.setViewportSize({ width: 320, height: 700 });
  await trigger().click();
  const box = await listbox.boundingBox();
  assert(box && box.width <= 320 && box.x >= 0, `panel fits narrow viewport (${JSON.stringify(box)})`);

  // 减少动态效果：面板照常可用
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Escape');
  await trigger().click();
  await row('mimo-v2.6-pro').click();
  await radiogroup.getByRole('radio', { name: 'on' }).click();
  assert.match((await trigger().innerText()).replace(/\s+/g, ' '), /mimo-v2\.6-pro · on/, 'reduced motion keeps interaction');

  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ triggerPairing: true, twoLineRows: true, effortFollowsModel: true,
    noLevelRow: true, clickClosesOnEffort: true, keyboardModelAndDots: true, perModelMemory: true,
    escapeSafety: true, narrowFit: true, reducedMotion: true, browserErrors: errors.length }));
} finally {
  await browser.close();
}
