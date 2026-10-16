import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Exercise the real sidebar; every courseware request stays in this fixture.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1544, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const makeRows = () => Array.from({ length: 5 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (i === 3 ? 1 : i === 4 ? 3 : 0));
  date.setMinutes(date.getMinutes() - i);
  return { id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i}`, title: `动效测试 ${i + 1}`,
    revision: 1, created_at: date.toISOString(), updated_at: date.toISOString(), archived_at: null,
    commands: [], messages: [] };
});
let rows = makeRows();
let failDelete = false;
let captureTarget = null;
let captureSurvivor = null;
const button = name => page.getByRole('button', { name, exact: true });
const menu = page.getByRole('dialog', { name: '课件操作', exact: true });
const nav = page.getByRole('navigation', { name: '历史课件' });

async function startCapture(target, survivor) {
  await page.evaluate(({ target, survivor }) => {
    const started = performance.now(), samples = [];
    const find = title => [...document.querySelectorAll('nav[aria-label="历史课件"] button[title]')]
      .find(button => button.title === title)?.closest('li');
    const deleted = find(target);
    const moving = find(survivor);
    window.__sidebarCapture = new Promise(resolve => {
      const sample = () => {
        samples.push({ t: performance.now() - started,
          opacity: deleted?.isConnected ? Number(getComputedStyle(deleted).opacity) : null,
          x: deleted?.isConnected ? deleted.getBoundingClientRect().x : null,
          y: moving?.isConnected ? moving.getBoundingClientRect().y : null,
          groupOpacity: deleted?.isConnected ? Number(getComputedStyle(deleted.closest('section')).opacity) : null });
        if (performance.now() - started < 650) requestAnimationFrame(sample);
        else resolve(samples);
      };
      requestAnimationFrame(sample);
      setTimeout(() => resolve(samples), 2000);
    });
  }, { target, survivor });
}

async function deleteOne(title) {
  await button(`课件操作：${title}`).click();
  await menu.getByRole('button', { name: '删除', exact: true }).click();
  await menu.getByRole('button', { name: '删除', exact: true }).click();
}

try {
  await page.route('**/api/coursewares**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/delete')) {
      if (failDelete) return route.fulfill({ status: 500, json: { error: '测试删除失败' } });
      if (captureTarget) await startCapture(captureTarget, captureSurvivor);
      const ids = request.postDataJSON().ids;
      rows = rows.filter(row => !ids.includes(row.id));
    }
    const record = rows.find(row => url.pathname.endsWith(`/${row.id}`));
    await route.fulfill({ json: record ?? { records: rows } });
  });
  await stubConstructionDraft(page);
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded' });
  await button('动效测试 5').waitFor();
  await page.getByText('正在读取本地课件…', { exact: true }).waitFor({ state: 'detached' });

  failDelete = true;
  await deleteOne('动效测试 2');
  await page.getByText('测试删除失败', { exact: true }).waitFor();
  assert.equal(await button('动效测试 2').count(), 1, 'failed deletion must keep the row');
  await menu.getByRole('button', { name: '取消', exact: true }).click();
  await page.keyboard.press('Escape');
  failDelete = false;

  captureTarget = '动效测试 2'; captureSurvivor = '动效测试 3';
  await deleteOne(captureTarget);
  await button(captureTarget).waitFor({ state: 'detached' });
  const samples = await page.evaluate(() => window.__sidebarCapture);
  assert(samples.some(s => s.opacity > 0 && s.opacity < 1), 'deleted row must visibly fade before removal');
  assert(samples.some(s => s.x !== null && s.x < 7.9), 'deleted row must slide slightly left');
  const positions = [...new Set(samples.map(s => s.y).filter(y => y !== null))];
  assert(positions.length > 3 && positions.at(-1) < positions[0], 'surviving row must move through intermediate positions');
  await mkdir(new URL('../spike-out/sidebar-delete-motion/', import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL('../spike-out/sidebar-delete-motion/after-single.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });

  captureTarget = '动效测试 4'; captureSurvivor = '动效测试 5';
  await deleteOne(captureTarget);
  await page.getByRole('region', { name: '昨天', exact: true }).waitFor({ state: 'detached' });
  const groupSamples = await page.evaluate(() => window.__sidebarCapture);
  assert(groupSamples.some(s => s.groupOpacity > 0 && s.groupOpacity < 1), 'last row of a date group must fade with its group');
  const groupPositions = [...new Set(groupSamples.map(s => s.y).filter(y => y !== null))];
  assert(groupPositions.length > 3, 'next date group must smoothly move up');

  captureTarget = null;
  await button('搜索课件').click();
  const search = page.getByRole('searchbox', { name: '搜索课件标题' });
  await search.fill('动效测试 1');
  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll('nav li')].find(row => row.textContent.includes('动效测试 3'));
    return row && Number(getComputedStyle(row).opacity) < 1;
  });
  await search.fill('');
  await button('关闭搜索').click();
  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll('nav li')].find(row => row.textContent.includes('动效测试 3'));
    return row && getComputedStyle(row).pointerEvents === 'auto' && Number(getComputedStyle(row).opacity) === 1;
  });
  await button('动效测试 1').click();
  await page.waitForURL(/history_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0/);
  await deleteOne('动效测试 1');
  await page.waitForURL(/action=new/);
  await button('动效测试 1').waitFor({ state: 'detached' });
  assert.equal(await nav.locator('li').count(), 2);

  await button('选择').click();
  await button('全选').click();
  await button('删除所选课件').click();
  await button('确认删除').click();
  await nav.getByText('暂无课件，点击“新建课件”开始。', { exact: true }).waitFor();
  await nav.locator('li').last().waitFor({ state: 'detached' });
  assert.equal(rows.length, 0, 'batch deletion must remove all fixture records');

  rows = makeRows();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await button('动效测试 5').waitFor();
  captureTarget = '动效测试 2'; captureSurvivor = '动效测试 3';
  await deleteOne(captureTarget);
  await button(captureTarget).waitFor({ state: 'detached' });
  const reduced = await page.evaluate(() => window.__sidebarCapture);
  assert(!reduced.some(s => s.opacity > 0 && s.opacity < 1), 'reduced motion must skip fading');
  assert(!reduced.some(s => s.x !== null && s.x < 7.9), 'reduced motion must skip sliding');
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ failedDeletionRetainsRow: true, exitFade: true, exitSlide: true,
    layoutPositions: positions.length, groupLayoutPositions: groupPositions.length,
    rapidSearchRestoresInteraction: true, activeDeletionNavigates: true, batchToEmpty: true, reducedMotion: true, browserErrors: errors.length }));
} finally {
  await browser.close();
}
