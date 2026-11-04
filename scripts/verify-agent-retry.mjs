import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Isolated courseware/stream fixtures: no user records or provider calls.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const artifacts = new URL('../spike-out/agent-retry/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = Date.now();
let record = { id, title: '错误提示验证', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
  revision: 1, archived_at: null, commands: [], messages: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1544, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
  await stubConstructionDraft(page);
  await page.route('**/api/coursewares**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture' } });
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      record = { ...record, ...body, revision: (body.expectedRevision ?? record.revision) + 1 };
      return route.fulfill({ json: record });
    }
    return route.fulfill({ json: new URL(route.request().url()).pathname.endsWith(id) ? record : { records: [record], ok: true } });
  });
  await page.route('**/api/agent**', route => {
    assert.equal(route.request().method(), 'GET');
    return route.fulfill({ json: { runtimes: [{ id: 'claude-code', name: 'Claude Code', version: 'fixture', usable: true, canAttachImages: true }] } });
  });
  await page.addInitScript(() => {
    localStorage.setItem('mm.agentId', 'claude-code');
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (new URL(String(input), location.href).pathname !== '/api/agent' || init?.method !== 'POST') return fetch(input, init);
      window.__request = JSON.parse(init.body);
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        window.__emit = event => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
        window.__finish = () => controller.close();
        init.signal.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), { once: true });
      } }), { headers: { 'content-type': 'application/x-ndjson' } }));
    };
  });
  await page.goto('http://localhost:3000/dashboard?history_id=' + id);
  const panel = page.locator('aside[aria-label=对话]');
  const latest = panel.locator('[data-slot=aui_assistant-message-root]').last();
  const emit = event => page.evaluate(event => window.__emit(event), event);
  const start = async text => {
    await page.getByRole('textbox', { name: '题目描述' }).fill(text);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.waitForFunction(text => window.__request?.text === text, text);
  };
  await start('临时限流');
  await emit({ kind: 'retry', retryAt: Date.now() + 13_000, attempt: 1, reason: 'rate_limit' });
  await latest.getByText('模型服务暂时受限', { exact: true }).first().waitFor();
  const timer = latest.locator('[data-slot=run-activity-duration]');
  const initial = await timer.innerText();
  assert.match(initial, /秒后重试/);
  await page.waitForFunction(text => document.querySelector('[data-agent-execution=running] [data-slot=run-activity-duration]')?.textContent !== text, initial);
  assert.equal(await latest.getByRole('alert').count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL('retry-light.png', artifacts)) });
  await emit({ kind: 'retry', retryAt: null });
  await emit({ kind: 'text-delta', text: '已恢复回复。' });
  await emit({ kind: 'done' });
  await page.evaluate(() => window.__finish());
  await latest.locator('[data-agent-execution=completed]').waitFor();
  assert.equal(await latest.getByText('模型服务暂时受限', { exact: true }).count(), 0);
  await start('额度耗尽');
  await emit({ kind: 'error', code: 'quota_exhausted', message: '模型服务的可用额度已用尽。' });
  // A later CLI cancellation must not replace the actionable first error.
  await emit({ kind: 'error', message: 'Request aborted' });
  await emit({ kind: 'done', status: 'cancelled' });
  await page.evaluate(() => window.__finish());
  await latest.locator('[data-agent-execution=error]').waitFor();
  const notice = latest.locator('[data-agent-diagnostic=quota]');
  await notice.getByText('模型服务额度已用尽', { exact: true }).waitFor();
  assert.equal(await notice.getAttribute('role'), 'alert');
  assert.equal(await notice.getByRole('button', { name: '重新检测', exact: true }).count(), 0);
  assert.equal(await notice.getByText('Request aborted', { exact: true }).count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL('quota-light.png', artifacts)) });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.documentElement.style.colorScheme = 'dark'; });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'dark');
  await panel.screenshot({ path: fileURLToPath(new URL('quota-dark.png', artifacts)) });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; document.documentElement.style.colorScheme = 'light'; });
  await page.setViewportSize({ width: 1024, height: 768 });
  assert(await notice.evaluate(el => el.scrollWidth <= el.clientWidth));
  await panel.screenshot({ path: fileURLToPath(new URL('quota-narrow.png', artifacts)) });
  await start('停止重试');
  await emit({ kind: 'retry', retryAt: Date.now() + 30_000, attempt: 2, reason: 'unavailable' });
  await latest.getByText('模型服务暂时不可用', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: '停止本轮', exact: true }).click();
  await latest.locator('[data-agent-execution=stopped]').waitFor();
  assert.equal(await latest.getByRole('alert').count(), 0);
  assert.equal(await latest.getByText('模型服务暂时不可用', { exact: true }).count(), 0);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ ok: true, scenarios: ['retry countdown', 'recovery', 'quota first error', 'light/dark/narrow', 'cancel retry'], artifacts: fileURLToPath(artifacts) }));
} finally { await browser.close(); }
