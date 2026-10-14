import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Actual GeoGebra/downloads; database traffic is isolated to this fixture.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1544, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const directory = 'spike-out/courseware-export-menu';
await mkdir(directory, { recursive: true });
const errors = [], downloads = [];
page.on('pageerror', error => errors.push(error.message));
page.on('download', download => downloads.push(download.suggestedFilename()));
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let record = { id, title: '导出菜单验收', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  messages: [], commands: ['A=(1,2)'], view: { showAxes: true, showGrid: true } };
await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [{ id: 'claude-code', name: 'Claude Code', version: 'fixture', usable: true }] } }));
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.route('**/api/coursewares**', route => {
  const url = new URL(route.request().url());
  if (url.pathname.includes('/windows')) return route.fulfill({ json: { ok: true } });
  if (route.request().method() === 'POST') {
    assert.equal(url.pathname, '/api/coursewares', 'only fixture autosaves are allowed');
    const body = route.request().postDataJSON();
    record = { ...record, ...body, revision: (body.expectedRevision ?? 0) + 1 };
    return route.fulfill({ json: record });
  }
  return route.fulfill({ json: url.pathname.endsWith(id) ? record : { records: [record], capabilities: { archive: true, permanentDelete: true } } });
});
const trigger = page.getByRole('button', { name: '导出', exact: true });
const menu = page.getByRole('menu', { name: '导出', exact: true });
const items = () => menu.getByRole('menuitem');
const focused = index => page.waitForFunction(index => {
  const items = document.querySelectorAll('[role=menu] [role=menuitem]');
  return document.activeElement === items[index];
}, index);
const escaped = async () => {
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  assert(await trigger.evaluate(element => element === document.activeElement), 'Escape restores trigger focus');
};
const download = async (extension, action) => {
  const before = downloads.length;
  const pending = page.waitForEvent('download');
  await action();
  const result = await pending;
  assert.equal(await result.failure(), null);
  assert.equal(result.suggestedFilename(), `导出菜单验收.${extension}`);
  await result.saveAs(`${directory}/courseware.${extension}`);
  await menu.waitFor({ state: 'detached' });
  assert.equal(downloads.length, before + 1, 'one menu selection produces one download');
  assert(await trigger.evaluate(element => element === document.activeElement), 'selection restores trigger focus');
};
try {
  await page.goto(`${process.argv[2] || 'http://localhost:3000'}/dashboard?history_id=${id}`);
  await page.waitForFunction(() => window.ggbApplet?.exists?.('A'), null, { timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('button[aria-label="导出"]')?.disabled);
  await page.addStyleTag({ content: 'nextjs-portal { display:none !important; }' });
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  await menu.waitFor(); await focused(0);
  assert.equal(await items().count(), 3);
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('ArrowDown'); await focused(1);
  await page.keyboard.press('End'); await focused(2);
  await page.keyboard.press('Home'); await focused(0);
  await page.keyboard.press('ArrowUp'); await focused(2);
  await escaped();
  await trigger.click(); await menu.waitFor();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${directory}/menu.png` });
  const board = await page.getByRole('main', { name: '数学课件画布' }).boundingBox();
  await page.mouse.click(board.x + 20, board.y + board.height / 2);
  await menu.waitFor({ state: 'detached' });
  await trigger.focus(); await page.keyboard.press('Enter'); await focused(0);
  await download('html', () => page.keyboard.press('Enter'));
  await trigger.click();
  await download('ggb', () => menu.getByRole('menuitem', { name: /导出 \.GGB 课件/ }).click());
  await trigger.click();
  await download('png', () => menu.getByRole('menuitem', { name: /导出 PNG 截图/ }).click());
  const html = await readFile(`${directory}/courseware.html`, 'utf8');
  assert(html.includes('导出菜单验收') && html.includes('ggbBase64'), 'HTML contains title and canvas snapshot');
  assert.equal((await readFile(`${directory}/courseware.ggb`)).subarray(0, 2).toString(), 'PK');
  assert.equal((await readFile(`${directory}/courseware.png`)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  // Native fullscreen renders portals within the fullscreen workspace.
  await page.getByRole('button', { name: '全屏演示', exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await trigger.click(); await menu.waitFor();
  assert(await menu.evaluate(element => document.fullscreenElement?.contains(element)));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${directory}/fullscreen-menu.png` });
  await download('png', () => menu.getByRole('menuitem', { name: /导出 PNG 截图/ }).click());
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  // Embedded browsers use the existing presentation fallback instead.
  await page.evaluate(() => { HTMLElement.prototype.requestFullscreen = async () => { throw new Error('fixture fullscreen fallback'); }; });
  await page.getByRole('button', { name: '全屏演示', exact: true }).click();
  await page.getByRole('button', { name: '退出全屏', exact: true }).waitFor();
  await trigger.click(); await menu.waitFor(); await escaped();
  assert(await page.getByRole('button', { name: '退出全屏', exact: true }).isVisible(), 'menu Escape preserves presentation view');
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await page.setViewportSize({ width: 960, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trigger.click(); await menu.waitFor();
  const box = await menu.boundingBox();
  assert(box.x >= 0 && box.x + box.width <= 960 && box.y >= 0 && box.y + box.height <= 640);
  assert.equal(await menu.evaluate(element => getComputedStyle(element).animationName), 'none');
  await escaped();
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/result.json`, JSON.stringify({ ok: true, downloads, pageErrors: errors, scenarios: ['arrow/Home/End/wrap navigation', 'Escape and selection focus restoration', 'canvas click closes menu', 'HTML/GGB/PNG contents', 'single download per selection', 'native fullscreen menu and download', 'presentation fallback', 'narrow viewport', 'reduced motion'] }, null, 2));
  console.log('Courseware export menu regression passed; actual downloads, fixture database only.');
} catch (error) {
  await page.screenshot({ path: `${directory}/failure.png` });
  await writeFile(`${directory}/failure.json`, JSON.stringify({ error: error.message, pageErrors: errors, downloads }, null, 2));
  throw error;
} finally { await browser.close(); }
