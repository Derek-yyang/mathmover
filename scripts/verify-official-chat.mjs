import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// Real dashboard + GeoGebra; courseware writes and Agent streams are isolated fixtures.
const base = process.argv[2] || 'http://localhost:3000';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const artifacts = new URL('../spike-out/official-chat/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const output = name => new URL(name, artifacts).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = Date.now();
const fixturePage = await browser.newPage();
const image = await fixturePage.evaluate(() => {
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
  const pen = canvas.getContext('2d'); pen.fillStyle = '#fdfcf8'; pen.fillRect(0, 0, 320, 200);
  pen.strokeStyle = '#e7e5e4'; pen.beginPath();
  for (let x = 0; x < 320; x += 20) { pen.moveTo(x, 0); pen.lineTo(x, 200); }
  for (let y = 0; y < 200; y += 20) { pen.moveTo(0, y); pen.lineTo(320, y); } pen.stroke();
  pen.strokeStyle = '#047857'; pen.lineWidth = 3; pen.beginPath(); pen.moveTo(40, 20); pen.quadraticCurveTo(160, 340, 280, 20); pen.stroke();
  return canvas.toDataURL('image/png');
});
await fixturePage.close();
const markdown = '## 已建立抛物线\n\n函数为 $y=(x-1)^2$，顶点为 $(1,0)$。\n\n- 对称轴：$x=1$\n- 开口向上\n\n```geogebra\nf(x)=(x-1)^2\n' + 'W'.repeat(160) + '\n```\n\n$$\n' + Array.from({ length: 45 }, (_, i) => `x_{${i}}`).join('+') + '\n$$';
const message = (id, role, content, meta, attachments) => ({ id, role, content, createdAt: now, meta, attachments });
let record = { id, title: '官方聊天验证', category: null, created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(), revision: 1, archived_at: null, commands: [], messages: [
  message('u1', 'user', '绘制抛物线并说明顶点位置。'),
  message('a1', 'assistant', markdown, { status: 'completed', commands: ['f(x)=(x-1)^2'], execution: { status: 'completed', startedAt: now - 2000, endedAt: now, steps: [{ id: 's1', name: 'ggb_apply', status: 'returned' }] }, auditResult: { missing: [], undefinedObjs: [], degraded: false } }),
  message('u2', 'user', '请看看这张题图。', undefined, [{ id: 'image-1', name: '题目.png', contentType: 'image/png', url: image }]),
  message('a2', 'assistant', '这是停止前保留的部分回复。', { status: 'stopped', execution: { status: 'stopped', startedAt: now - 1000, endedAt: now, steps: [] } }),
  message('u3', 'user', '继续解释。'),
  message('a3', 'assistant', '顶点对应函数的最小值，图形可在左侧画板中查看。'),
] };
try {
  const context = await browser.newContext({ viewport: { width: 1544, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/coursewares**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      record = { ...record, ...body, revision: (body.expectedRevision ?? record.revision) + 1 };
      await route.fulfill({ json: record });
    } else await route.fulfill({ json: new URL(route.request().url()).pathname.endsWith(id) ? record : { records: [record], ok: true } });
  });
  await page.route('**/api/agent', route => {
    assert.equal(route.request().method(), 'GET', 'POST must stay in the fixture stream');
    return route.fulfill({ json: { runtimes: [{ id: 'claude-code', name: 'Claude Code', version: 'fixture', usable: true, canAttachImages: true }] } });
  });
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (new URL(String(input), location.href).pathname === '/api/agent' && init?.method === 'POST') {
        window.__agentRequest = JSON.parse(init.body);
        const stream = new ReadableStream({ start(controller) {
          window.__emitAgent = event => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
          window.__finishAgent = () => controller.close();
          init.signal.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')), { once: true });
        } });
        return Promise.resolve(new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } }));
      }
      return realFetch(input, init);
    };
  });
  await page.goto(`${base}/dashboard?history_id=${id}`);
  await page.locator('[data-slot=aui_assistant-message-root]').first().waitFor();
  const panel = page.locator('aside[aria-label=对话]');
  const viewport = page.getByRole('region', { name: '聊天消息', exact: true });
  const turn = id => page.locator(`[data-chat-message-id=${id}]`);
  assert.equal(await panel.getByText('MathMover Agent', { exact: true }).count(), 0);
  const copy = turn('a3').getByRole('button', { name: '复制消息', exact: true });
  assert.equal(await copy.evaluate(el => getComputedStyle(el.closest('.aui-assistant-action-bar-root')).visibility), 'visible');
  await copy.click();
  await page.waitForFunction(text => navigator.clipboard.readText().then(value => value === text), record.messages[5].content);
  assert.equal(await turn('a3').locator('.aui-assistant-action-bar-root button').count(), 1);
  assert.equal(await panel.getByRole('button', { name: '重新生成', exact: true }).count(), 0);
  await turn('a1').getByRole('button', { name: /本轮已结束/ }).click();
  await turn('a1').locator('[data-tool-step-status]').waitFor();
  assert.equal(await turn('a1').locator('[data-tool-step-status]').getAttribute('data-tool-step-status'), 'returned');
  assert.equal(await turn('a2').locator('[data-agent-execution]').getAttribute('data-agent-execution'), 'stopped');
  assert.equal(await panel.getByText('尚未收到工具活动。', { exact: true }).count(), 0);
  await panel.screenshot({ path: output('activity.png') });
  await turn('a1').getByRole('button', { name: /本轮已结束/ }).click();
  await turn('u2').getByRole('button', { name: '预览图片：题目.png', exact: true }).click();
  const preview = page.getByRole('dialog');
  await preview.waitFor();
  assert.equal(await preview.locator('img').getAttribute('src'), image);
  await page.keyboard.press('Escape');
  const handle = page.getByRole('separator', { name: '调整聊天区宽度' });
  const widths = [];
  for (const key of ['Home', 'End']) {
    await handle.focus(); await page.keyboard.press(key);
    const dimensions = await viewport.evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
    assert.equal(dimensions.width, dimensions.scrollWidth);
    widths.push(dimensions);
  }
  await handle.dblclick();
  await viewport.evaluate(el => { el.scrollTop = 0; });
  await panel.screenshot({ path: output('history.png') });
  await turn('a1').locator('.aui-md-pre').evaluate(el => { el.scrollLeft = 120; });
  assert(await turn('a1').locator('.aui-md-pre').evaluate(el => el.scrollLeft > 0));
  const bottomButton = panel.getByRole('button', { name: '回到最新', exact: true });
  async function returnToLatest(smooth) {
    await bottomButton.waitFor();
    await viewport.evaluate(el => {
      const start = el.scrollTop;
      const target = el.scrollHeight - el.clientHeight;
      const samples = [];
      const startedAt = performance.now();
      window.__bottomTrace = null;
      const measure = () => {
        samples.push(el.scrollTop);
        const elapsed = performance.now() - startedAt;
        if (Math.abs(el.scrollTop - target) <= 1 || elapsed > 2000) {
          window.__bottomTrace = { start, target, samples, elapsed };
        } else requestAnimationFrame(measure);
      };
      requestAnimationFrame(measure);
    });
    await bottomButton.click();
    await page.waitForFunction(() => window.__bottomTrace !== null);
    const trace = await page.evaluate(() => window.__bottomTrace);
    assert(trace.target - trace.start > 100, 'fixture must have room to scroll');
    assert(Math.abs(trace.samples.at(-1) - trace.target) <= 1, 'must land at latest');
    assert.equal(trace.samples.some(top => top > trace.start + 1 && top < trace.target - 1), smooth,
      'normal motion must show intermediate positions; reduced motion must jump directly');
    return { elapsed: Math.round(trace.elapsed), frames: trace.samples.length };
  }
  const bottomScrolling = { manual: await returnToLatest(true) };
  await panel.locator('[data-turn-id=u1]').click();
  await page.waitForFunction(() => document.querySelector('[aria-label=聊天消息]').scrollTop <= 5);
  bottomScrolling.fromIndex = await returnToLatest(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await viewport.evaluate(el => { el.scrollTo({ top: 0, behavior: 'instant' }); });
  bottomScrolling.reducedMotion = await returnToLatest(false);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const input = page.getByRole('textbox', { name: '题目描述' });
  const send = page.getByRole('button', { name: '发送消息', exact: true });
  const emit = event => page.evaluate(event => window.__emitAgent(event), event);
  async function startRun(text) {
    await input.fill(text);
    await page.waitForFunction(() => !document.querySelector('[aria-label=发送消息]').disabled);
    await send.click();
    await page.waitForFunction(text => window.__agentRequest?.text === text, text);
    await page.locator('[data-agent-execution=running]').waitFor();
  }
  await startRun('测试流式回复');
  await emit({ kind: 'session', sessionId: 'fixture-old-session' });
  const latest = page.locator('[data-chat-message=assistant]').last();
  const timer = latest.locator('[data-agent-execution=running] [data-slot=run-activity-duration]');
  const initialTime = await timer.textContent();
  const timerStyle = () => timer.evaluate(el => {
    const style = getComputedStyle(el);
    return { fill: style.webkitTextFillColor, animation: style.animationName, numerals: style.fontVariantNumeric, opacity: style.opacity };
  });
  const initialStyle = await timerStyle();
  assert.notEqual(initialStyle.fill, 'transparent');
  assert.notEqual(initialStyle.fill, 'rgba(0, 0, 0, 0)');
  assert.equal(initialStyle.animation, 'none');
  assert.equal(initialStyle.numerals, 'tabular-nums');
  assert.equal(initialStyle.opacity, '1');
  await page.waitForFunction(text => document.querySelector('[data-agent-execution=running] [data-slot=run-activity-duration]')?.textContent !== text, initialTime);
  assert.deepEqual(await timerStyle(), initialStyle);
  assert.equal(await latest.getByRole('button', { name: '复制消息', exact: true }).count(), 0);
  assert.equal(await panel.getByRole('button', { name: '编辑', exact: true }).count(), 0);
  await emit({ kind: 'tool-call', name: 'ggb_get_state', toolCallId: 'fixture-1' });
  await emit({ kind: 'text-delta', text: '这是一段正在生成的回复。' });
  await latest.getByText('这是一段正在生成的回复。', { exact: true }).waitFor();
  await panel.screenshot({ path: output('streaming.png') });
  await viewport.evaluate(el => { el.scrollTo({ top: 0, behavior: 'instant' }); });
  bottomScrolling.duringRun = await returnToLatest(true);
  const growth = '\n\n' + Array.from({ length: 10 }, (_, i) => `继续生成的第 ${i + 1} 段内容。`).join('\n\n');
  await emit({ kind: 'text-delta', text: growth });
  await latest.getByText('继续生成的第 10 段内容。', { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const el = document.querySelector('[aria-label=聊天消息]');
    return el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
  });
  await latest.locator('[data-agent-execution] > [data-slot=tool-group-trigger]').click();
  await latest.locator('[data-tool-step-status]').waitFor();
  await emit({ kind: 'tool-result', name: 'ggb_get_state', toolCallId: 'fixture-1', isError: true });
  await emit({ kind: 'done' });
  await page.evaluate(() => window.__finishAgent());
  await latest.locator('[data-agent-execution=completed]').waitFor();
  assert.equal(await latest.locator('[data-agent-execution] > [data-slot=tool-group-trigger]').getAttribute('aria-expanded'), 'true');
  assert.equal(await latest.locator('[data-tool-step-status]').getAttribute('data-tool-step-status'), 'error');
  await latest.getByRole('button', { name: '复制消息', exact: true }).waitFor();
  await startRun('测试停止');
  await emit({ kind: 'tool-call', name: 'ggb_apply', toolCallId: 'fixture-stopped-tool' });
  await emit({ kind: 'text-delta', text: '停止时仍保留这段内容。' });
  await latest.getByText('停止时仍保留这段内容。', { exact: true }).waitFor();
  await emit({ kind: 'text-delta', text: '停止前最后一小段。' });
  await page.evaluate(() => document.querySelector('[aria-label=停止本轮]').click());
  await latest.locator('[data-agent-execution=stopped]').waitFor();
  assert.equal(await latest.locator('[data-agent-execution]').getAttribute('data-agent-execution'), 'stopped');
  await latest.getByText('停止时仍保留这段内容。停止前最后一小段。', { exact: true }).waitFor();
  await latest.locator('[data-agent-execution] > [data-slot=tool-group-trigger]').click();
  await latest.locator('[data-tool-step-status]').waitFor();
  assert.equal(await latest.locator('[data-tool-step-status]').getAttribute('data-tool-step-status'), 'unconfirmed');
  assert.equal(await latest.locator('[role=alert]').count(), 0);
  await startRun('测试错误提示');
  await emit({ kind: 'error', message: '验证用错误：连接中断' });
  await emit({ kind: 'done' });
  await page.evaluate(() => window.__finishAgent());
  await latest.locator('[data-agent-execution=error]').waitFor();
  assert.equal(await latest.locator('[data-agent-execution]').getAttribute('data-agent-execution'), 'error');
  await latest.getByRole('alert').waitFor();
  await panel.screenshot({ path: output('error.png') });

  // Edits use the upstream composer and only the retained conversation prefix.
  const editedInput = page.getByRole('textbox', { name: '修改消息', exact: true });
  await turn('u3').hover();
  await turn('u3').getByRole('button', { name: '编辑', exact: true }).click();
  await editedInput.waitFor();
  assert.equal(await editedInput.inputValue(), '继续解释。');
  await editedInput.fill('');
  assert(await panel.getByRole('button', { name: '重新发送', exact: true }).isDisabled());
  await editedInput.fill('取消后不应写入');
  await panel.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await editedInput.count(), 0);
  assert.equal(await turn('u3').locator('.aui-user-message-content').innerText(), '继续解释。');
  assert.equal(await page.evaluate(() => window.__agentRequest.text), '测试错误提示');

  await page.waitForFunction(() => !!window.ggbApplet?.getAllObjectNames);
  await page.evaluate(() => window.ggbApplet.evalCommand('EditFixturePoint=(2,3)'));
  await turn('u2').hover();
  await turn('u2').getByRole('button', { name: '编辑', exact: true }).click();
  await editedInput.waitFor();
  assert.equal(await editedInput.inputValue(), '请看看这张题图。');
  await panel.locator('.aui-edit-composer-root .aui-composer-attachments img').waitFor();
  await editedInput.fill('修改后请重新解释题图。');
  await panel.screenshot({ path: output('editing.png') });
  await panel.getByRole('button', { name: '重新发送', exact: true }).click();
  await page.waitForFunction(() => window.__agentRequest.text === '修改后请重新解释题图。');
  const editedRequest = await page.evaluate(() => window.__agentRequest);
  assert.equal(editedRequest.sessionId, undefined);
  assert.equal(editedRequest.restartFromHistory, true);
  assert.deepEqual(editedRequest.history, record.messages.slice(0, 2).map(m => ({role:m.role,content:m.content})));
  assert.equal(editedRequest.images.length, 1);
  assert.equal(editedRequest.images[0].base64, image.split(',')[1]);
  assert.equal(await turn('u3').count(), 0);
  assert.equal(await turn('a2').count(), 0);
  assert.equal(await page.evaluate(() => window.ggbApplet.getAllObjectNames().includes('EditFixturePoint')), true);
  const completedEditSave = page.waitForResponse(response => {
    if (!response.url().includes('/api/coursewares') || response.request().method() !== 'POST') return false;
    const messages = response.request().postDataJSON().messages;
    return messages?.at(-1)?.content === '编辑后的回复。' && messages.at(-1).meta?.execution?.status === 'completed';
  });
  await emit({ kind: 'session', sessionId: 'fixture-edited-session' });
  await emit({ kind: 'text-delta', text: '编辑后的回复。' });
  await emit({ kind: 'done' });
  await page.evaluate(() => window.__finishAgent());
  await latest.locator('[data-agent-execution=completed]').waitFor();
  await completedEditSave;
  assert.deepEqual(record.messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(record.messages[2].content, '修改后请重新解释题图。');
  assert.equal(record.messages[2].attachments[0].url, image);
  assert.equal(record.sessionId, 'fixture-edited-session');
  await page.reload();
  await page.getByText('编辑后的回复。', { exact: true }).waitFor();
  assert.equal(await panel.getByText('修改后请重新解释题图。', { exact: true }).count(), 1);
  assert.equal(await turn('u3').count(), 0);
  assert.equal(await panel.getByRole('button', { name: '预览图片：题目.png', exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.ggbApplet.getAllObjectNames().includes('EditFixturePoint')), true);
  await panel.screenshot({ path: output('edited.png') });

  // Editing the first question has no retained parent/history.
  await turn('u1').hover();
  await turn('u1').getByRole('button', { name: '编辑', exact: true }).click();
  await editedInput.waitFor();
  await editedInput.fill('修改第一条问题。');
  await panel.getByRole('button', { name: '重新发送', exact: true }).click();
  await page.waitForFunction(() => window.__agentRequest.text === '修改第一条问题。');
  const firstEdit = await page.evaluate(() => window.__agentRequest);
  assert.deepEqual(firstEdit.history, []);
  assert.equal(firstEdit.sessionId, undefined);
  assert.equal(firstEdit.restartFromHistory, true);
  assert.equal(firstEdit.images, undefined);
  assert.equal(await page.locator('[data-chat-message=user]').count(), 1);
  await emit({ kind: 'text-delta', text: '第一条问题的新回复。' });
  await emit({ kind: 'done' });
  await page.evaluate(() => window.__finishAgent());
  await latest.locator('[data-agent-execution=completed]').waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ officialMessages: true, math: true, copy: true, copyOnly: true, fullImagePreview: true, toolDisclosure: true, widths, bottomScrolling, streaming: true, timerLegible: true, stop: true, errorsVisible: true, editing: true, editPersistence: true, canvasRetained: true, pageErrors: errors }));
} finally { await browser.close(); }
