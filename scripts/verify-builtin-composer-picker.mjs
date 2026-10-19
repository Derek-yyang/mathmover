/**
 * 内置位在合成器里**有模型选择器**、且**有档位选择器** —— 回归守卫。
 *
 * 起因（2026-10-18 用户报）：内置位的模型清单原本写死成一条「默认」，而合成器的
 * 选择器要求「>1 个选项」才渲染 ⇒ 整块控件消失，看起来像"没有模型可选"。
 *
 * 两段：
 *  A. **真数据**（跑当前 dev server 与已配好的端点）：模型清单来自端点的真清单。
 *  B. **打桩**：档位清单在真实环境里得先在设置里手填才有，为了能确定性地验
 *     「填了之后合成器出现档位圆点」，这一段直接桩掉 /api/agent 的返回。
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function newPage(init) {
  const context = await browser.newContext({ viewport: { width: 1544, height: 900 } });
  await context.addInitScript(() => { try { localStorage.setItem('mm.agentId', 'byok'); } catch {} });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/coursewares**', (r) => r.fulfill({ json: { records: [] } }));
  await stubConstructionDraft(page);
  if (init) await init(page);
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('textbox', { name: '题目描述' }).waitFor({ timeout: 60_000 });
  return { page, errors };
}

const report = [];
try {
  // ---- A. 真数据：模型选择器在，且选项 ≥2 ----
  {
    const { page, errors } = await newPage();
    const header = page.locator('span[aria-label^="当前 Agent："]');
    await header.waitFor({ timeout: 30_000 });
    assert.match((await header.getAttribute('aria-label')) ?? '', /内置 Agent/);

    const trigger = page.getByRole('button', { name: /^选择模型与推理档位/ });
    await trigger.waitFor({ timeout: 30_000 });
    await trigger.click();
    const options = await page.getByRole('listbox').getByRole('option').all();
    const names = await Promise.all(options.map((o) => o.innerText()));
    assert.ok(options.length >= 2, `模型选项应 ≥2（实测 ${options.length}：${names.join(' / ')}）`);
    assert.ok(!names.every((n) => n.includes('默认')), '清单不该只有「默认」那一条');
    assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
    report.push(`A 模型选择器：${options.length} 个选项（${names.join(' / ')}）`);
    await page.keyboard.press('Escape');
    await page.context().close();
  }

  // ---- B. 打桩：声明了档位 ⇒ 合成器出现档位圆点 ----
  {
    const levels = [{ id: 'low', label: 'low' }, { id: 'high', label: 'high', default: true }];
    const { page, errors } = await newPage(async (p) => {
      await p.route('**/api/agent?**', (r) => r.fulfill({ json: {
        ok: true, daemon: 'http://127.0.0.1:8788', canvasConnected: true, activeRuntime: 'byok',
        runtimes: [{
          id: 'byok', name: '内置 Agent（OpenCode）', version: '自带 runtime · 无需安装',
          usable: true, authStatus: 'ok', canAttachImages: true,
          models: {
            list: [
              { id: 'stub-a', label: 'stub-a', reasoningOptions: levels },
              { id: 'stub-b', label: 'stub-b', reasoningOptions: levels },
            ],
            source: 'live',
          },
        }],
      } }));
      await p.route('**/api/agent', (r) => r.fulfill({ json: {
        ok: true, daemon: 'http://127.0.0.1:8788', canvasConnected: true, activeRuntime: 'byok',
        runtimes: [{
          id: 'byok', name: '内置 Agent（OpenCode）', version: '自带 runtime · 无需安装',
          usable: true, authStatus: 'ok', canAttachImages: true,
          models: {
            list: [
              { id: 'stub-a', label: 'stub-a', reasoningOptions: levels },
              { id: 'stub-b', label: 'stub-b', reasoningOptions: levels },
            ],
            source: 'live',
          },
        }],
      } }));
    });
    const trigger = page.getByRole('button', { name: /^选择模型与推理档位/ });
    await trigger.waitFor({ timeout: 30_000 });
    await trigger.click();
    const dots = await page.getByRole('radio').all();
    const labels = await Promise.all(dots.map((d) => d.getAttribute('aria-label')));
    assert.equal(dots.length, 2, `档位圆点应有 2 个（实测 ${dots.length}）`);
    assert.deepEqual(labels, ['low', 'high']);
    assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
    report.push(`B 档位选择器：${dots.length} 个（${labels.join(' / ')}）`);
    await page.context().close();
  }

  console.log(`PASS: 内置位合成器控件齐备 —— ${report.join('；')}`);
} finally {
  await browser.close();
}
