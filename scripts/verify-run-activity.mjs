import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Actual Chrome/GeoGebra UI; model, credentials, sockets and database are fixtures.
const out = 'spike-out/run-activity';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = Date.now(), errors = [];
let record = { id, title: '执行过程验证', revision: 1, archived_at: null, commands: ['A=(1,2)'],
  created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
  messages: [{ id: 'legacy-user', role: 'user', content: '旧问题', createdAt: now - 1000 },
    { id: 'legacy-answer', role: 'assistant', content: '旧记录的完整正文保留。', createdAt: now - 500 }] };
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => {
  assert.equal(route.request().method(), 'GET', 'model POST must stay in fixture stream');
  return route.fulfill({ json: { runtimes: [{ id: 'fixture', name: '测试 Agent', version: 'fixture', usable: true, canAttachImages: true }] } });
});
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await page.route('**/api/coursewares**', route => {
  const req = route.request(), url = new URL(req.url());
  if (url.pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture' } });
  if (req.method() === 'GET') return route.fulfill({ json: url.pathname.endsWith(id) ? record : { records: [record], capabilities: { archive: true, permanentDelete: true } } });
  assert.equal(url.pathname, '/api/coursewares');
  assert.equal(req.method(), 'POST');
  const body = req.postDataJSON();
  record = { ...record, ...body, revision: (body.expectedRevision ?? record.revision) + 1 };
  return route.fulfill({ json: record });
});
await page.addInitScript(() => {
  localStorage.setItem('mm.agentId', 'fixture');
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (new URL(String(input), location.href).pathname === '/api/agent' && init?.method === 'POST') {
      window.__agentRequest = JSON.parse(init.body);
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        window.__emit = events => events.forEach(event => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n')));
        window.__finish = () => controller.close();
        init.signal.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), { once: true });
      } }), { headers: { 'content-type': 'application/x-ndjson' } }));
    }
    return realFetch(input, init);
  };
});
const latest = page.locator('[data-chat-message=assistant]').last();
const disclosure = () => latest.locator('[data-slot=run-activity] > [data-slot=collapsible] > [data-slot=collapsible-trigger]');
const labelSelector = '[data-slot=run-activity-label], [data-slot=thinking-indicator-label]';
const label = () => latest.locator(labelSelector);
const expectLabel = text => page.waitForFunction(text =>
  [...document.querySelectorAll('[data-slot=run-activity-label], [data-slot=thinking-indicator-label]')].at(-1)?.textContent === text, text);
const indicator = () => latest.locator('[data-slot=thinking-indicator]');
const summaryGeometry = () => indicator().evaluate(el => {
  const root = el.closest('[data-slot=run-activity]').getBoundingClientRect();
  const dot = el.querySelector('[data-slot=thinking-indicator-dot]').getBoundingClientRect();
  const label = el.querySelector('[data-slot=thinking-indicator-label]').getBoundingClientRect();
  return { dotX: dot.x - root.x, dotY: dot.y - root.y, labelX: label.x - root.x,
    rowHeight: el.parentElement.getBoundingClientRect().height,
    seconds: Number(el.querySelector('[data-slot=run-activity-duration]').textContent.match(/(\d+) 秒/)[1]) };
});
const body = () => latest.locator('.aui-md');
const emit = events => page.evaluate(events => window.__emit(events), events);
const finish = async events => {
  await emit(events);
  await page.evaluate(() => window.__finish());
  await latest.locator('[data-agent-execution]:not([data-agent-execution=running])').waitFor();
};
const start = async text => {
  await page.getByRole('textbox', { name: '题目描述', exact: true }).fill(text);
  await page.waitForFunction(() => !document.querySelector('[aria-label=发送消息]').disabled);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.waitForFunction(text => window.__agentRequest?.text === text, text);
  await latest.locator('[data-agent-execution=running]').waitFor();
};
const poll = async predicate => {
  for (let i = 0; i < 250 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert(predicate(), 'fixture snapshot persisted');
};
try {
  await stubConstructionDraft(page);
  await page.goto(`http://localhost:3000/dashboard?history_id=${id}`);
  await page.getByText('旧记录的完整正文保留。', { exact: true }).waitFor();
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await start('交替过程和最终回答');
  await expectLabel('处理中…');
  await indicator().waitFor();
  assert.equal(await disclosure().count(), 0, 'no empty disclosure before activity arrives');
  const waiting = await indicator().evaluate(el => {
    const dot = el.querySelector('[data-slot=thinking-indicator-dot]');
    const label = el.querySelector('[data-slot=thinking-indicator-label]');
    window.__waitingLabel = label;
    return { dotAnimation: getComputedStyle(dot).animationName, dotColor: getComputedStyle(dot).backgroundColor,
      primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
      shimmerAnimation: getComputedStyle(label, '::before').animationName };
  });
  assert.equal(waiting.dotAnimation, 'pulse');
  assert.equal(waiting.dotColor, 'rgb(4, 120, 87)', 'pulse uses the light theme primary');
  assert.notEqual(waiting.shimmerAnimation, 'none', 'official shimmer is active');
  await page.waitForFunction(() => {
    const last = [...document.querySelectorAll('[data-slot=thinking-indicator]')].at(-1);
    return last?.querySelector('[data-slot=run-activity-duration]')?.textContent !== '· 0 秒';
  });
  assert(await indicator().evaluate(el => el.querySelector('[data-slot=thinking-indicator-label]') === window.__waitingLabel),
    'clock ticks preserve the label node and do not restart its animation');
  await page.screenshot({ path: `${out}/waiting-thinking-indicator.png` });
  const viewport = page.getByRole('region', { name: '聊天消息', exact: true });
  const scrollGeometry = () => viewport.evaluate(el => {
    const bubble = [...el.querySelectorAll('.aui-user-message-content')].at(-1);
    const rect = bubble.getBoundingClientRect();
    return { width: el.clientWidth, overflowing: el.scrollHeight > el.clientHeight,
      gutter: el.offsetWidth - el.clientWidth, userLeft: rect.left, userRight: rect.right };
  });
  const beforeScrollbar = await scrollGeometry();
  assert.equal(beforeScrollbar.overflowing, false, 'short conversation has no vertical overflow');
  await viewport.evaluate(el => {
    const probe = document.createElement('div');
    probe.dataset.scrollbarProbe = 'true';
    probe.style.height = '1200px';
    el.append(probe);
  });
  const withScrollbar = await scrollGeometry();
  assert.equal(withScrollbar.overflowing, true, 'long content requires scrolling');
  assert.equal(withScrollbar.width, beforeScrollbar.width, 'scrollbar appearance preserves content width');
  assert.equal(withScrollbar.userLeft, beforeScrollbar.userLeft, 'scrollbar appearance preserves user message position');
  assert.equal(withScrollbar.userRight, beforeScrollbar.userRight, 'scrollbar appearance preserves user message right edge');
  await viewport.evaluate(el => el.querySelector('[data-scrollbar-probe]').remove());
  const afterScrollbar = await scrollGeometry();
  assert.equal(afterScrollbar.width, beforeScrollbar.width, 'scrollbar removal preserves content width');
  assert.equal(afterScrollbar.userRight, beforeScrollbar.userRight, 'scrollbar removal preserves user message position');
  const beforeDisclosure = await summaryGeometry();
  await emit([
    { kind: 'text-delta', messageId: 'n1', text: '我先读取' }, { kind: 'text-delta', messageId: 'n1', text: '画板。' },
    { kind: 'text', messageId: 'n1', text: '我先读取画板。' },
    { kind: 'text-phase', messageId: 'n1', phase: 'commentary' },
  ]);
  await disclosure().waitFor();
  await expectLabel('处理中…');
  const afterDisclosure = await summaryGeometry();
  assert.equal(afterDisclosure.dotX, beforeDisclosure.dotX, 'adding the disclosure arrow preserves the dot position');
  assert.equal(afterDisclosure.dotY, beforeDisclosure.dotY, 'adding activity preserves vertical alignment');
  assert.equal(afterDisclosure.labelX, beforeDisclosure.labelX, 'adding activity preserves the text start');
  assert.equal(afterDisclosure.rowHeight, beforeDisclosure.rowHeight, 'empty and expandable summary rows share the same height');
  assert(afterDisclosure.seconds >= beforeDisclosure.seconds, 'the clock never resets when activity first arrives');
  await page.screenshot({ path: `${out}/first-disclosure-stable-position.png` });
  await emit([{ kind: 'tool-call', name: 'ggb_get_state', toolCallId: 'read' }]);
  await expectLabel('正在读取画板…');
  await page.screenshot({ path: `${out}/running-current-read.png` });
  await emit([
    { kind: 'tool-result', toolCallId: 'read', output: 'RAW_RESULT_SECRET' },
    { kind: 'text', messageId: 'n2', phase: 'commentary', text: '接下来检查对象。' },
    { kind: 'tool-call', name: 'ggb_apply', toolCallId: 'apply' },
  ]);
  await expectLabel('正在更新构造并自检…');
  await disclosure().waitFor();
  assert.equal(await body().count(), 0, 'narration never enters answer body');
  assert.equal(await latest.getByText('我先读取画板。', { exact: true }).count(), 0, 'narration starts folded');
  await page.screenshot({ path: `${out}/running-collapsed.png` });
  assert.equal(await label().count(), 1, 'single current activity label, no stale second line');
  const oneLine = await disclosure().evaluate(el => ({ height: el.getBoundingClientRect().height,
    width: el.clientWidth, scroll: el.scrollWidth }));
  assert(oneLine.height < 40 && oneLine.scroll <= oneLine.width, 'summary stays on one line without overflow');
  await emit([{ kind: 'tool-result', toolCallId: 'apply' }]);
  await expectLabel('更新构造并自检 · 已返回');
  await disclosure().click();
  await latest.locator('[data-slot=run-commentary]').first().waitFor();
  assert.deepEqual(await latest.locator('[data-activity-kind]').evaluateAll(items => items.map(item => item.dataset.activityKind)), ['commentary', 'tool', 'commentary', 'tool']);
  assert.deepEqual(await latest.locator('[data-slot=run-commentary]').allTextContents(), ['我先读取画板。', '接下来检查对象。']);
  await emit([{ kind: 'text-delta', messageId: 'answer', phase: 'final', text: '椭圆已建立，' },
    { kind: 'text-delta', messageId: 'answer', phase: 'final', text: '方程为 $x^2/4+y^2=1$。' },
    { kind: 'thinking', text: 'PRIVATE_THINKING_SECRET' }]);
  await body().getByText('椭圆已建立，', { exact: false }).waitFor();
  await finish([{ kind: 'text', messageId: 'answer', phase: 'final', text: '椭圆已建立，方程为 $x^2/4+y^2=1$。' },
    { kind: 'done', resultText: '椭圆已建立，方程为 $x^2/4+y^2=1$。' }]);
  await latest.locator('.katex').waitFor();
  await expectLabel('本轮已结束');
  assert.equal(await indicator().count(), 0, 'completion removes live pulse and shimmer');
  assert.equal(await disclosure().getAttribute('aria-expanded'), 'true', 'completion preserves expansion');
  assert.equal(await latest.locator('.katex').count(), 1);
  await page.screenshot({ path: `${out}/completed-open.png` });
  await disclosure().click();
  await latest.locator('[data-slot=run-commentary]').first().waitFor({ state: 'hidden' });
  assert(await body().isVisible(), 'answer remains visible while activity is folded');
  await latest.getByRole('button', { name: '复制消息', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '椭圆已建立，方程为 $x^2/4+y^2=1$。');
  await poll(() => record.messages.at(-1)?.content === '椭圆已建立，方程为 $x^2/4+y^2=1$。');
  assert(!JSON.stringify(record.messages).includes('RAW_RESULT_SECRET'));
  assert(!JSON.stringify(record.messages).includes('PRIVATE_THINKING_SECRET'));
  await page.screenshot({ path: `${out}/completed-collapsed.png` });
  await page.reload();
  await body().getByText('椭圆已建立，', { exact: false }).waitFor();
  assert.equal(await latest.locator('[data-slot=run-commentary]').count(), 0);
  await disclosure().click();
  assert.deepEqual(await latest.locator('[data-slot=run-commentary]').allTextContents(), ['我先读取画板。', '接下来检查对象。']);

  await start('并行工具的当前步骤');
  await emit([{ kind: 'tool-call', name: 'Read', toolCallId: 'parallel-read' },
    { kind: 'tool-call', name: 'Bash', toolCallId: 'parallel-shell' }]);
  await expectLabel('正在执行命令…');
  await disclosure().focus();
  await page.keyboard.press('Enter');
  await latest.locator('[data-tool-step-status]').first().waitFor();
  await emit([{ kind: 'tool-result', toolCallId: 'parallel-shell' }]);
  await expectLabel('正在读取文件…');
  assert.equal(await disclosure().getAttribute('aria-expanded'), 'true', 'new events preserve expansion');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-slot=collapsible-trigger]')]
    .some(el => el.getAttribute('aria-expanded') === 'false' && el.textContent.includes('正在读取文件')));
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const reduced = await indicator().evaluate(el => {
    const dot = el.querySelector('[data-slot=thinking-indicator-dot]');
    const label = el.querySelector('[data-slot=thinking-indicator-label]');
    return { dot: getComputedStyle(dot).animationName, dotColor: getComputedStyle(dot).backgroundColor,
      label: getComputedStyle(label).animationName, shimmer: getComputedStyle(label, '::before').animationPlayState };
  });
  assert.equal(reduced.dot, 'none');
  assert.equal(reduced.dotColor, 'rgb(110, 231, 183)', 'pulse follows the dark theme primary');
  assert.equal(reduced.label, 'none');
  assert.equal(reduced.shimmer, 'paused');
  assert.equal(await disclosure().getAttribute('aria-expanded'), 'false');
  const narrow = await disclosure().evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  assert.equal(narrow.client, narrow.scroll, 'current step fits the narrow chat pane');
  // Let the disclosure's 200ms scroll lock settle before positioning the screenshot.
  await page.waitForTimeout(250);
  await disclosure().scrollIntoViewIfNeeded();
  assert(await disclosure().isVisible());
  assert(await disclosure().evaluate(el => {
    const rect = el.getBoundingClientRect();
    const viewport = el.closest('[data-slot=thread-viewport]') ?? el.closest('[role=region]');
    const bounds = viewport?.getBoundingClientRect();
    return rect.top >= (bounds?.top ?? 0) && rect.bottom <= (bounds?.bottom ?? innerHeight);
  }), 'screenshot shows the running summary inside the viewport');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: `${out}/running-current-dark-narrow.png` });
  await emit([{ kind: 'tool-result', toolCallId: 'parallel-read' }]);
  await expectLabel('读取文件 · 已返回');
  await finish([{ kind: 'done', resultText: '并行工具执行结束。' }]);
  await expectLabel('本轮已结束');
  assert.equal(await indicator().count(), 0);
  assert.equal(await disclosure().getAttribute('aria-expanded'), 'false', 'completion preserves collapsed state');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.setViewportSize({ width: 1440, height: 900 });

  await start('快速工具返回后保持可读');
  // Calls/results may arrive within one paint. Their observed result must stay
  // visible rather than flashing the action and reverting to generic waiting.
  await emit([{ kind: 'tool-call', name: 'ggb_get_state', toolCallId: 'fast-read' },
    { kind: 'tool-result', toolCallId: 'fast-read' }]);
  await expectLabel('读取画板 · 已返回');
  await page.evaluate(() => {
    window.__fastLabels = [];
    const root = [...document.querySelectorAll('[data-slot=run-activity]')].at(-1);
    window.__fastObserver = new MutationObserver(() => window.__fastLabels.push(
      root.querySelector('[data-slot=thinking-indicator-label]')?.textContent));
    window.__fastObserver.observe(root, { subtree: true, childList: true, characterData: true });
  });
  await emit([{ kind: 'text', messageId: 'post-read', phase: 'commentary', text: '继续检查。' }]);
  await page.waitForTimeout(1100);
  assert.equal(await label().textContent(), '读取画板 · 已返回');
  assert((await page.evaluate(() => window.__fastLabels)).every(text => text === '读取画板 · 已返回'),
    'subsequent commentary and clock ticks never revert the latest step to generic waiting');
  await page.evaluate(() => window.__fastObserver.disconnect());
  await disclosure().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/fast-tool-return-retained.png` });
  await emit([{ kind: 'tool-call', name: 'ggb_apply', toolCallId: 'fast-next' }]);
  await expectLabel('正在更新构造并自检…');
  await emit([{ kind: 'tool-result', toolCallId: 'fast-next', isError: true }]);
  await expectLabel('更新构造并自检 · 返回错误');
  assert(await latest.getByRole('button', { name: '查看过程', exact: true }).isVisible());
  await finish([{ kind: 'done', resultText: '工具返回错误。' }]);
  await expectLabel('本轮结束 · 有工具返回错误');

  await start('旧协议没有 phase');
  await emit([{ kind: 'text', text: '我先读取旧协议画板。' }, { kind: 'tool-call', name: 'ggb_get_state', toolCallId: 'legacy-call' },
    { kind: 'tool-result', toolCallId: 'legacy-call' }, { kind: 'text-delta', text: '未分类的最终回答保留。' }]);
  await finish([{ kind: 'done' }]);
  await body().getByText('未分类的最终回答保留。', { exact: true }).waitFor();
  assert(!(await body().textContent()).includes('我先读取'));

  await start('停止时保留部分回答');
  await emit([{ kind: 'text', phase: 'commentary', text: '准备读取。' },
    { kind: 'tool-call', name: 'ggb_get_state', toolCallId: 'stop-call' }, { kind: 'text-delta', text: '已写出的部分回答。' }]);
  await page.getByRole('button', { name: '停止本轮', exact: true }).click();
  await latest.locator('[data-agent-execution=stopped]').waitFor();
  await expectLabel('已停止 · 本轮未跑完');
  assert.equal(await indicator().count(), 0, 'stopping removes live motion');
  await body().getByText('已写出的部分回答。', { exact: true }).waitFor();
  assert(!(await body().textContent()).includes('准备读取'));

  await start('错误保持可见');
  await emit([{ kind: 'text', phase: 'commentary', text: '正在检查。' }, { kind: 'tool-call', name: 'ggb_apply', toolCallId: 'failed' },
    { kind: 'tool-result', toolCallId: 'failed', isError: true }, { kind: 'error', message: 'fixture runtime failed' }]);
  await finish([{ kind: 'done' }]);
  await latest.locator('[data-agent-execution=error]').waitFor();
  await expectLabel('本轮中断');
  assert.equal(await indicator().count(), 0, 'errors remove live motion');
  assert(await latest.getByRole('button', { name: '查看过程', exact: true }).isVisible());
  assert(await latest.locator('[role=alert]').count() > 0, 'actionable runtime error stays outside');
  await latest.getByRole('button', { name: '查看过程', exact: true }).click();
  await latest.locator('[data-tool-step-status=error]').waitFor();
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dimensions = await page.getByRole('region', { name: '聊天消息', exact: true }).evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  assert.equal(dimensions.client, dimensions.scroll);
  await page.screenshot({ path: `${out}/error-narrow.png` });
  await poll(() => record.messages.at(-1)?.meta?.status === 'error');
  record.messages.push({ id: 'interrupted-user', role: 'user', content: '上次未跑完的问题', createdAt: now + 2000 },
    { id: 'interrupted-answer', role: 'assistant', content: '', createdAt: now + 2100,
      meta: { status: 'generating', execution: { status: 'running', startedAt: now, steps: [] },
        activity: [{ id: 'old-narration', kind: 'text', phase: 'commentary', text: '上次的过程说明。' },
          { id: 'old-pending', kind: 'text', phase: 'pending', text: '上次尚未分类的部分回答。' }] } });
  await page.reload();
  await body().getByText('上次尚未分类的部分回答。', { exact: true }).waitFor();
  assert.equal(await latest.getByText('上次的过程说明。', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.__agentRequest), undefined, 'recovery never reruns a model');
  await page.screenshot({ path: `${out}/interrupted-recovery.png` });
  assert.deepEqual(errors, []);
  await writeFile(`${out}/results.json`, JSON.stringify({ passed: true, errors, persistedActivity: true,
    summaryGeometry: { beforeDisclosure, afterDisclosure },
    scrollbarGeometry: { beforeScrollbar, withScrollbar, afterScrollbar },
    scenarios: ['official thinking indicator', 'theme primary pulse', 'clock preserves label animation', 'reduced motion stops pulse and shimmer', 'live current step', 'fast tool result retained without pretending to run', 'parallel calls', 'keyboard and expansion state', 'dark narrow summary', 'streamed narration folded', 'ordered tools', 'no delta/snapshot duplication', 'final markdown and copy', 'reload', 'legacy protocol', 'stop', 'error visibility', 'narrow/reduced motion', 'interrupted snapshot recovery'] }, null, 2));
  console.log('PASS: RunActivity narration/tool order, final answer/copy, persistence, legacy, stop/error, narrow/reduced motion.');
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` });
  console.log(await page.locator('aside[aria-label=对话]').innerText());
  console.log('Page errors:', errors);
  throw error;
} finally { await browser.close(); }
