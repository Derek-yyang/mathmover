import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// All configuration, courseware, WebSocket and generation requests are fixtures.
// No real provider requests, credentials or user data writes.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const scenario of ['save-provider', 'reload-stale']) {
    const page = await browser.newPage({ viewport: { width: 1544, height: 900 } });
    page.setDefaultTimeout(15_000);
    const errors = [], sent = [];
    page.on('pageerror', error => errors.push(error.message));
    const oldModel = 'glm-5.3-flash-free', newModel = 'deepseek-flash';
    let config = { baseUrl: scenario === 'save-provider' ? 'https://old.fixture.invalid/v1' : 'https://new.fixture.invalid/v1',
      model: scenario === 'save-provider' ? oldModel : newModel, apiFormat: 'openai-chat',
      apiKeyConfigured: true, apiKeyTail: '1234', reasoningLevels: '' };
    const runtime = () => ({ id: 'byok', name: '内置Agent', version: 'fixture', usable: true, authStatus: 'ok', canAttachImages: true,
      models: { source: 'live', list: [{ id: config.model, label: `${config.model}（设置里配置的）` }, { id: 'alternative-model', label: 'Alternative' }] } });
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now = new Date().toISOString();
    let record = { id, title: '模型同步验证', created_at: now, updated_at: now, revision: 1, archived_at: null, commands: [], messages: [] };
    await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
    await stubConstructionDraft(page);
    await page.route('**/api/coursewares**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture' } });
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        record = { ...record, ...body, revision: (body.expectedRevision ?? record.revision) + 1 };
        return route.fulfill({ json: record });
      }
      return route.fulfill({ json: path.endsWith(id) ? record : { records: [record] } });
    });
    await page.route('**/api/agent**', route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { runtimes: [runtime()] } });
      sent.push(route.request().postDataJSON());
      return route.fulfill({ body: JSON.stringify({ kind: 'done' }) + '\n', contentType: 'application/x-ndjson' });
    });
    await page.route('**/api/byok', route => {
      if (route.request().method() === 'POST') {
        const { apiKey, ...saved } = route.request().postDataJSON();
        assert.equal(apiKey, 'fixture-replacement');
        config = { ...config, ...saved };
        return route.fulfill({ json: { ...config, runtime: runtime() } });
      }
      return route.fulfill({ json: config });
    });
    await page.addInitScript(oldModel => {
      if (!sessionStorage.getItem('fixture-initialized')) {
        localStorage.setItem('mm.agentId', 'byok');
        localStorage.setItem('mathmover_model_by_agent', JSON.stringify({ byok: oldModel }));
        sessionStorage.setItem('fixture-initialized', 'true');
      }
    }, oldModel);
    await page.goto('http://localhost:3000/dashboard?history_id=' + id);
    const trigger = page.getByRole('button', { name: /^选择模型与推理档位/ });
    await trigger.filter({ hasText: config.model }).waitFor();
    if (scenario === 'save-provider') {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '设置', exact: true });
      const panel = page.getByRole('tabpanel', { name: '模型 API', exact: true });
      await panel.getByRole('textbox', { name: 'API 端点', exact: true }).fill('https://new.fixture.invalid/v1');
      await panel.getByRole('textbox', { name: '模型', exact: true }).fill(newModel);
      const key = panel.getByLabel(/^API 密钥/);
      await key.focus(); await key.fill('fixture-replacement');
      // Deliberately leave effort untouched: this was the broken save branch.
      await panel.getByRole('button', { name: '保存', exact: true }).click();
      await panel.getByText('已保存', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: '关闭设置', exact: true }).click();
    }
    await trigger.filter({ hasText: newModel }).waitFor();
    await page.waitForFunction(model => JSON.parse(localStorage.getItem('mathmover_model_by_agent')).byok === model, newModel);
    const send = async (text, expected) => {
      await page.getByRole('textbox', { name: '题目描述' }).fill(text);
      const response = page.waitForResponse(response => response.url().endsWith('/api/agent') && response.request().method() === 'POST');
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await response;
      await page.waitForFunction(() => document.querySelector('button[aria-label="停止本轮"]')?.getAttribute('aria-hidden') === 'true');
      assert.equal(sent.at(-1)?.model, expected, `${scenario}: request matches displayed model`);
    };
    await send('验证切换后的模型', newModel);
    // Explicit valid model choices survive a metadata refresh/page reload.
    await trigger.click();
    await page.getByRole('option', { name: 'Alternative', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.reload();
    await trigger.filter({ hasText: 'Alternative' }).waitFor();
    await send('验证保留手动选择', 'alternative-model');
    assert.deepEqual(errors, []);
    console.log(`PASS: ${scenario}; actual outgoing models ${sent.map(request => request.model).join(', ')}`);
    await page.close();
  }
} finally { await browser.close(); }
