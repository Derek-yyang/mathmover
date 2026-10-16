import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Real dashboard/GeoGebra; no model requests or real courseware/draft writes.
const out = 'spike-out/command-code-block';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const commands = ['ShowGrid(1, true)', 'O = (0, 0)', 'lenA = 3', 'lenB = 2',
  'conicC = Ellipse((-sqrt(lenA^2-lenB^2),0), (sqrt(lenA^2-lenB^2),0), lenA)',
  'Text("<tag> & 中文 `反引号`", (0,0))'];
const source = commands.join('\n');
const now = new Date().toISOString();
const answer = '椭圆已画好。';
let record = { id, title: '构造指令代码块', revision: 1, archived_at: null, commands,
  created_at: now, updated_at: now, messages: [
    { id: 'user', role: 'user', content: '画一个椭圆', createdAt: Date.now() - 1000 },
    { id: 'answer', role: 'assistant', content: `${answer}\n\n\`\`\`typescript\nconst x = 1;\n\`\`\``, createdAt: Date.now(), meta: { status: 'completed', commands } },
  ] };
const errors = [], results = [], highlighterRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
page.on('request', request => { if (/GgbCodeHighlight|shiki/i.test(request.url())) highlighterRequests.push(request.url()); });
await page.route('**/api/agent**', route => {
  assert.equal(route.request().method(), 'GET');
  return route.fulfill({ json: { runtimes: [{ id: 'fixture', name: '测试 Agent', version: 'fixture', usable: true, canAttachImages: true }] } });
});
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await page.route('**/api/coursewares**', route => {
  const req = route.request(), url = new URL(req.url());
  if (url.pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture' } });
  if (req.method() === 'GET') return route.fulfill({ json: url.pathname.endsWith(id) ? record : { records: [record], capabilities: { archive: true, permanentDelete: true } } });
  assert.equal(req.method(), 'POST');
  assert.equal(url.pathname, '/api/coursewares');
  record = { ...record, ...req.postDataJSON(), revision: record.revision + 1 };
  return route.fulfill({ json: record });
});
await stubConstructionDraft(page);
await page.addInitScript(() => localStorage.setItem('mm.agentId', 'fixture'));
try {
  await page.goto(`http://localhost:3000/dashboard?history_id=${id}`);
  const assistant = page.locator('[data-chat-message=assistant]').last();
  await assistant.getByText(answer, { exact: true }).waitFor();
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  const trigger = assistant.getByRole('button', { name: `构造指令 · ${commands.length} 条`, exact: true });
  const block = assistant.locator('[data-slot=code-block]');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await block.isVisible(), false, 'construction stays folded by default');
  assert.deepEqual(highlighterRequests, [], 'collapsed commands do not load the highlighter');
  await trigger.focus();
  await page.keyboard.press('Enter');
  await block.waitFor();
  const metrics = () => block.locator('pre').evaluate(el => ({ height: el.getBoundingClientRect().height,
    font: getComputedStyle(el).font, codeFont: getComputedStyle(el.querySelector('code')).font,
    padding: getComputedStyle(el).padding, border: getComputedStyle(el).borderWidth,
    text: el.textContent, html: el.outerHTML.slice(0, 1100) }));
  const beforeHighlight = await metrics();
  await block.locator('pre.shiki code span').first().waitFor();
  const afterHighlight = await metrics();
  assert(Math.abs(beforeHighlight.height - afterHighlight.height) <= 1, JSON.stringify({ beforeHighlight, afterHighlight }));
  assert.equal(await block.locator('code').textContent(), source);
  assert.equal(await block.locator('code tag').count(), 0, 'commands are literal text, never interpreted as HTML/Markdown');
  assert.equal(await block.locator('.aui-code-header-language').textContent(), 'GeoGebra');
  await block.getByRole('button', { name: '复制代码', exact: true }).click();
  await block.getByRole('button', { name: '已复制', exact: true }).waitFor();
  // Windows' system clipboard normalizes line separators to CRLF.
  const clipboardText = async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
  assert.equal(await clipboardText(), source);
  // The ordinary Markdown block shares the extracted header/pre surface.
  const markdown = assistant.locator('.aui-md');
  assert.equal(await markdown.locator('.aui-code-header-language').textContent(), 'typescript');
  await markdown.getByRole('button', { name: '复制代码', exact: true }).click();
  await markdown.getByRole('button', { name: '已复制', exact: true }).waitFor();
  assert.equal(await clipboardText(), 'const x = 1;\n');
  for (const theme of ['light', 'dark']) {
    // Exercise next-themes' cross-window update, including native color-scheme.
    await page.evaluate(theme => {
      localStorage.setItem('mm.theme', theme);
      window.dispatchEvent(new StorageEvent('storage', { key: 'mm.theme', newValue: theme }));
    }, theme);
    await page.waitForFunction(theme => document.documentElement.dataset.theme === theme && getComputedStyle(document.documentElement).colorScheme === theme, theme);
    for (const width of [1440, 960]) {
      await page.setViewportSize({ width, height: 900 });
      await block.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      const geometry = await block.evaluate(el => {
        const pre = el.querySelector('pre'), viewport = el.closest('.chat-scroll-viewport');
        const rect = el.getBoundingClientRect(), view = viewport.getBoundingClientRect();
        return { width: rect.width, left: rect.left, right: rect.right, viewLeft: view.left, viewRight: view.right,
          viewportClient: viewport.clientWidth, viewportScroll: viewport.scrollWidth,
          preClient: pre.clientWidth, preScroll: pre.scrollWidth,
          background: getComputedStyle(pre).backgroundColor, color: getComputedStyle(pre).color };
      });
      assert(geometry.left >= geometry.viewLeft && geometry.right <= geometry.viewRight, 'block stays inside chat');
      assert.equal(geometry.viewportScroll, geometry.viewportClient, 'long line never widens the chat');
      assert(geometry.preScroll > geometry.preClient, 'long command scrolls within code block');
      const pre = block.locator('pre');
      const tokenColors = await block.locator('code span').evaluateAll(items => [...new Set(items.map(el => getComputedStyle(el).color))]);
      assert(tokenColors.length >= 4, 'commands, numbers and strings have different colors');
      await pre.focus();
      await page.keyboard.press('End');
      await pre.evaluate(el => { el.scrollLeft = el.scrollWidth; });
      assert(await pre.evaluate(el => el.scrollLeft > 0));
      await pre.evaluate(el => { el.scrollLeft = 0; el.blur(); });
      await page.screenshot({ path: `${out}/${theme}-${width}.png` });
      results.push({ theme, viewportWidth: width, tokenColors, ...geometry });
    }
  }
  assert.notEqual(results[0].background, results[2].background, 'background follows theme');
  assert.notDeepEqual(results[0].tokenColors, results[2].tokenColors, 'token colors follow theme');
  await trigger.click();
  await block.waitFor({ state: 'hidden' });
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  // A failed lazy chunk must leave the literal commands and copy action usable.
  await page.route('**/*GgbCodeHighlight*', route => route.abort());
  await page.reload();
  await trigger.waitFor();
  const failedChunk = page.waitForEvent('requestfailed', { predicate: request => /GgbCodeHighlight/.test(request.url()) });
  await trigger.click();
  await failedChunk;
  await block.locator('pre.aui-md-pre').waitFor();
  assert.equal(await block.locator('code').textContent(), source);
  await block.getByRole('button', { name: '复制代码', exact: true }).click();
  await block.getByRole('button', { name: '已复制', exact: true }).waitFor();
  assert.equal(await clipboardText(), source, 'failed highlighter still allows exact copy');
  assert.deepEqual(errors, []);
  assert(highlighterRequests.length > 0, 'highlighter chunk loads after expansion');
  await writeFile(`${out}/results.json`, JSON.stringify({ passed: true, errors, exactClipboard: true, keyboardDisclosure: true,
    highlighterRequests, plainFallbackOnLoadFailure: true, beforeHeight: beforeHighlight.height, afterHeight: afterHighlight.height, results }, null, 2));
  console.log(JSON.stringify({ passed: true, scenarios: results.length, errors }));
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` });
  throw error;
} finally { await browser.close(); }
