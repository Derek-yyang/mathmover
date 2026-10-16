import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const out = 'spike-out/save-status';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let record = { id, title: '保存状态验证', revision: 1, archived_at: null, messages: [], commands: ['A=(1,2)'],
  created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
let mode = 'fast', started = 0, finished = 0, release;
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [] } }));
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await page.route('**/api/coursewares**', async route => {
  const req = route.request(), url = new URL(req.url());
  if (url.pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture-ticket' } });
  if (req.method() === 'GET') return route.fulfill({ json: url.pathname.endsWith(id) ? record : { records: [record], capabilities: { archive: true, permanentDelete: true } } });
  assert.equal(url.pathname, '/api/coursewares', 'only fixture autosaves allowed');
  assert.equal(req.method(), 'POST');
  const currentMode = mode, body = req.postDataJSON();
  started++;
  if (currentMode.startsWith('hold')) await new Promise(resolve => { release = resolve; });
  else if (currentMode === 'fast') await new Promise(resolve => setTimeout(resolve, 100));
  if (currentMode.endsWith('fail')) {
    await route.fulfill({ status: 503, json: { error: '保存失败测试' } });
  } else {
    assert.equal(body.expectedRevision, record.revision);
    record = { ...record, ...body, revision: record.revision + 1 };
    await route.fulfill({ json: record });
  }
  finished++;
});
const notice = page.getByRole('status', { name: '课件保存状态', exact: true });
const poll = async predicate => {
  for (let i = 0; i < 200 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert(predicate(), 'fixture request settled');
};
const edit = value => page.evaluate(value => window.ggbApplet.setCoords('A', value, 2), value);
const clearNotices = () => page.evaluate(() => { window.__saveNotices = []; });
try {
  await stubConstructionDraft(page);
  await page.goto((process.argv[2] || 'http://localhost:3000') + '/dashboard?history_id=' + id);
  await page.waitForFunction(() => window.ggbApplet?.exists?.('A'));
  await page.waitForFunction(() => !document.querySelector('button[aria-label^="重命名课件："]')?.disabled);
  await page.addStyleTag({ content: 'nextjs-portal {display:none !important;}' });
  await page.evaluate(() => {
    window.__saveNotices = [];
    new MutationObserver(() => {
      const text = document.querySelector('[aria-label="课件保存状态"]')?.textContent;
      if (text) window.__saveNotices.push({ text, at: performance.now() });
    }).observe(document.querySelector('[data-slot=board-toolbar]'), { subtree: true, childList: true, characterData: true });
  });
  assert.equal(await notice.count(), 0, 'saved courseware opens without a success label');

  await edit(2);
  await page.waitForTimeout(400);
  assert.equal(started, 0, 'debounce has not started saving');
  assert.equal(await notice.count(), 0, 'dirty does not show a label');
  await poll(() => finished === 1);
  await page.waitForTimeout(150);
  assert.equal(await notice.count(), 0);
  assert.equal(await page.evaluate(() => window.__saveNotices.some(x => x.text === '保存中…')), false, 'fast save never flashes saving');

  mode = 'hold'; await clearNotices(); await edit(3);
  await poll(() => started === 2);
  await page.waitForTimeout(350);
  assert.equal(await notice.count(), 0, 'less than 1s into active save remains quiet');
  await notice.waitFor(); assert.equal(await notice.textContent(), '保存中…');
  // New updates must not hide or restart the in-flight save notice.
  await edit(4); await page.waitForTimeout(150);
  assert.equal(await notice.textContent(), '保存中…');
  await page.screenshot({ path: out + '/slow-save.png' });
  mode = 'fast'; release();
  await poll(() => finished >= 3);
  await notice.waitFor({ state: 'detached' });

  mode = 'fail'; await edit(5); await poll(() => started >= 4);
  const alert = page.getByRole('alert').filter({ hasText: '保存失败测试' });
  await alert.waitFor();
  assert(await alert.getByRole('button', { name: '重试', exact: true }).isVisible(), 'failure preserves retry');
  assert.equal(await notice.textContent(), '保存／恢复失败');
  await page.waitForTimeout(1200);
  assert.equal(await notice.textContent(), '保存／恢复失败', 'failure persists without stale saving timer');
  await page.screenshot({ path: out + '/failed-save.png' });
  mode = 'fast';
  const retryFinished = finished;
  await alert.getByRole('button', { name: '重试', exact: true }).click();
  await poll(() => finished > retryFinished);
  await alert.waitFor({ state: 'detached' }); await notice.waitFor({ state: 'detached' });
  await page.waitForTimeout(1200);
  assert.equal(await notice.count(), 0, 'retry success remains quiet');

  mode = 'hold-fail'; await edit(6);
  const countBefore = started; await poll(() => started > countBefore);
  await notice.waitFor(); assert.equal(await notice.textContent(), '保存中…');
  mode = 'fail'; release(); await alert.waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="课件保存状态"]')?.textContent === '保存／恢复失败');
  mode = 'fast'; const finalRetryFinished = finished;
  await alert.getByRole('button', { name: '重试', exact: true }).click();
  await poll(() => finished > finalRetryFinished);
  await alert.waitFor({ state: 'detached' }); await notice.waitFor({ state: 'detached' });
  await page.screenshot({ path: out + '/saved-quiet.png' });
  assert.deepEqual(errors, []);
  const result = { ok: true, fastSaveQuiet: true, debounceExcluded: true, slowSaveShown: true,
    editsDuringSaveKeepNotice: true, failureAndRetryVisible: true, retrySuccessQuiet: true, pageErrors: errors };
  await writeFile(out + '/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { release?.(); await browser.close(); }

