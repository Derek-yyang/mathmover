/**
 * 内置位的「推理档位」交互 —— 回归守卫。
 *
 * 为什么要有档位这栏：档位是**各家私有的方言**，端点上也读不到，所以要在这里配。
 * 词汇表取自 **opencode 自己的档位集合**（二进制里 `["none","minimal",...["low","medium","high"],"xhigh"]`），
 * **默认就是它默认的那三个** `low/medium/high`——不是我们拍的，也不做自由输入
 * （值必须是它认得的名字）。
 *
 * 三条要钉住的：
 *  1. 只有**有档位方言**的接口格式才给这栏（Anthropic/Gemini 那边我们的字段会被
 *     provider 丢掉，给一个点了没反应的控件是骗人）；
 *  2. 默认三个是选中的，其余可选；
 *  3. 值真的存进配置并被读回。
 *
 * 会临时改配置，**在 finally 里还原**（不碰 key）。
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const byokUrl = 'http://localhost:3000/api/byok';
const post = (body) => fetch(byokUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

const VOCAB = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const DEFAULTS = ['low', 'medium', 'high'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let original = null;

try {
  original = await fetch(byokUrl).then((r) => r.json());
  const context = await browser.newContext({ viewport: { width: 1544, height: 1000 } });
  // 一进来就选中内置位——末段要验"保存后对话区立刻跟上"，那要求内置位是活跃 agent
  await context.addInitScript(() => { try { localStorage.setItem('mm.agentId', 'byok'); } catch {} });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/coursewares**', (r) => r.fulfill({ json: { records: [] } }));
  await stubConstructionDraft(page);
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('textbox', { name: '题目描述' }).waitFor({ timeout: 60_000 });

  // 检测要跑一会儿；设置按钮在检测中不可用，重试几下
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.getByRole('button', { name: '设置', exact: true }).click({ timeout: 2_000 }).catch(() => {});
    if (await page.getByRole('tab', { name: /^(模型 API|API 提供商)/ }).count()) break;
    await page.waitForTimeout(800);
  }
  await page.getByRole('tab', { name: /^(模型 API|API 提供商)/ }).click({ timeout: 5_000 });
  await page.getByRole('heading', { name: /内置 Agent/ }).first().waitFor({ timeout: 15_000 });

  const panel = page.getByRole('tabpanel');
  const toggle = (value) => panel.getByRole('switch', { name: `档位 ${value}` });
  const checked = async () => {
    const out = [];
    for (const v of VOCAB) if ((await toggle(v).getAttribute('aria-checked')) === 'true') out.push(v);
    return out;
  };

  // 0. 先把档位清空，验"空 = 用默认那三个"
  await post({ reasoningLevels: '' });
  await page.getByRole('combobox', { name: '接口格式' }).click();
  await page.getByRole('option', { name: /OpenAI Chat/ }).click();
  await toggle('high').waitFor({ timeout: 5_000 });
  assert.deepEqual(await checked(), DEFAULTS, '空配置应显示默认那三个');
  assert.equal(await panel.getByRole('switch').count(), VOCAB.length, `词汇表应有 ${VOCAB.length} 个`);

  // 0b. 实时预览：与聊天区模型面板**同一个组件**渲染，且跟着勾选变
  const preview = panel.locator('[data-effort-preview]');
  await preview.waitFor({ timeout: 5_000 });
  assert.match(await preview.innerText(), /（low）/, '预览应显示当前档位（默认=最左那个）');
  await toggle('low').click();
  assert.match(await preview.innerText(), /（medium）/, '关掉最左的 low 后，当前档位应变成 medium');
  await toggle('low').click();

  // 1. 加一个可选的、去掉一个默认的
  await toggle('xhigh').click();
  await toggle('low').click();
  assert.deepEqual(await checked(), ['medium', 'high', 'xhigh']);

  // 2. `none` 与别的互斥（它就是"不要推理"这个真值）
  await toggle('none').click();
  assert.deepEqual(await checked(), ['none'], '选 none 应清掉其它');
  await toggle('none').click();       // 取消它 → 一个不剩 → 落成 none（不让空同时表示两件事）
  assert.deepEqual(await checked(), ['none'], '全部取消应落成 none，而不是回到默认');

  // 3. 切到 Anthropic ⇒ 整栏收起，如实说明（那边是另一套参数，传过去会被丢掉）
  await page.getByRole('combobox', { name: '接口格式' }).click();
  await page.getByRole('option', { name: /Anthropic/ }).click();
  await toggle('high').waitFor({ state: 'detached', timeout: 5_000 });
  await panel.getByText(/另一套参数/).waitFor({ timeout: 5_000 });

  // 4. 切回 OpenAI Chat，勾回默认三个，保存，读回配置
  await page.getByRole('combobox', { name: '接口格式' }).click();
  await page.getByRole('option', { name: /OpenAI Chat/ }).click();
  await toggle('high').waitFor({ timeout: 5_000 });
  await toggle('none').click();
  await toggle('low').click();
  assert.deepEqual(await checked(), ['low']);
  await toggle('medium').click();
  await toggle('high').click();
  assert.deepEqual(await checked(), DEFAULTS);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor({ timeout: 15_000 });
  const saved = await fetch(byokUrl).then((r) => r.json());
  assert.equal(saved.reasoningLevels, 'low,medium,high', `配置里应存默认三个，实际 ${JSON.stringify(saved.reasoningLevels)}`);
  assert.equal(saved.model, original.model, '不该动模型');
  assert.equal(saved.baseUrl, original.baseUrl, '不该动端点');

  // 5. 保存后**不刷新页面**，关掉设置，对话区应立刻跟上（用户报过这里不更新）
  await toggle('xhigh').click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '关闭设置' }).click();
  const trigger = page.getByRole('button', { name: /^选择模型与推理档位/ });
  await trigger.waitFor({ timeout: 30_000 });
  await trigger.click();
  // 等它出现再断言：清单可能还没探测回来，那条路径要走服务端重取（本来就慢）
  await page.getByRole('radio', { name: 'xhigh' }).waitFor({ timeout: 30_000 });
  const dots = await page.getByRole('radio').all();
  const dotLabels = await Promise.all(dots.map((d) => d.getAttribute('aria-label')));
  assert.deepEqual(dotLabels, ['low', 'medium', 'high', 'xhigh'], `对话区应立刻显示 4 个档位点，实际 ${JSON.stringify(dotLabels)}`);

  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  console.log(`PASS: 档位交互 —— 词汇表 ${VOCAB.length} 个、默认 ${DEFAULTS.join('/')}；可选增删；none 互斥；切 Anthropic 收起；保存读回「${saved.reasoningLevels}」`);
} finally {
  // 还原：只回写本来就有值的字段（key 一律不传 = 保留原 key）
  try {
    if (original) await post({
      baseUrl: original.baseUrl,
      model: original.model,
      apiFormat: original.apiFormat,
      reasoningLevels: original.reasoningLevels ?? '',
    });
  } catch { /* 服务已停：还原失败不该盖住原始失败 */ }
  await browser.close();
}
