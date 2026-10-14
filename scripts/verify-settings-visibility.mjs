import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// Isolated courseware API + real GeoGebra. No Agent calls or library writes.
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const directory = new URL('../spike-out/settings-visibility/', import.meta.url);
await mkdir(directory, { recursive: true });
try {
  const page = await browser.newPage();
  await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [], ok: true } }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function visiblePanel() {
    await page.waitForFunction(() => {
      const panel = document.querySelector('.PropertiesViewW');
      const sheet = panel?.querySelector('.sideSheet');
      if (!panel || !sheet) return false;
      const p = panel.getBoundingClientRect();
      const s = sheet.getBoundingClientRect();
      const frame = document.querySelector('.GeoGebraFrame').getBoundingClientRect();
      const hit = document.elementFromPoint(s.left + s.width / 2, s.top + 200);
      return p.width > 100 && s.width > 100 && s.left >= frame.left && s.right <= frame.right + 1 &&
        s.top >= frame.top && getComputedStyle(sheet).opacity === '1' &&
        hit?.closest('.PropertiesViewW') === panel;
    });
    assert(await page.getByRole('button', { name: 'Grid', exact: true }).isVisible(), 'native Grid row hidden');
    assert(await page.getByRole('button', { name: 'Axes', exact: true }).isVisible(), 'native Axes row hidden');
    return page.locator('.PropertiesViewW').evaluate(e => e.getBoundingClientRect().width);
  }
  async function verifySync(mode) {
    await page.waitForFunction(mode => {
      const api = window.ggbApplet;
      const o = api.getGraphicsOptions(mode === '3D' ? -1 : 1);
      const checks = [...document.querySelectorAll('.PropertiesViewW [role="checkbox"]')];
      const checked = text => checks.find(e => e.parentElement.textContent === text)?.getAttribute('aria-checked');
      return checked('Grid') === String(o.grid) &&
        checked('Axes') === String(o.axes.x.visible && o.axes.y.visible && (mode !== '3D' || o.axes.z.visible));
    }, mode);
  }
  for (const width of [1544, 2400]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${process.argv[2] || 'http://localhost:3000'}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.ggbApplet?.getViewProperties);
    await page.getByRole('button', { name: '画板设置', exact: true }).click();
    const initial = await visiblePanel();
    for (let i = 0; i < 12; i++) {
      await page.getByRole('button', { name: i % 2 ? '显示网格' : '显示坐标轴', exact: true }).click();
      assert.equal(await visiblePanel(), initial);
      await verifySync('2D');
    }
    await page.evaluate(() => {
      for (let i = 0; i < 20; i++) document.querySelector(`button[aria-label="${i % 2 ? '显示网格' : '显示坐标轴'}"]`).click();
    });
    assert.equal(await visiblePanel(), initial);
    await verifySync('2D');
    // A real native input action proves the visible content is usable, too.
    const gridRow = page.getByRole('button', { name: 'Grid', exact: true });
    const check = gridRow.getByRole('checkbox');
    const checked = await check.getAttribute('aria-checked');
    await check.click();
    await page.waitForFunction(checked => String(window.ggbApplet.getGraphicsOptions(1).grid) !== checked, checked);
    await page.getByRole('button', { name: '显示网格', exact: true }).click();
    assert.equal(await visiblePanel(), initial);
    await verifySync('2D');
    await page.screenshot({ path: new URL(`2d-${width}.png`, directory).pathname.replace(/^\/(\w:)/, '$1'), fullPage: false });
    console.log(JSON.stringify({ mode: '2D', viewport: width, panel: initial, clicks: 32, visible: true, usable: true, sync: true }));
  }
  await page.evaluate(() => window.ggbApplet.setPerspective('T'));
  await page.getByRole('button', { name: '画板设置', exact: true }).click();
  await page.getByRole('tab', { name: '3D Graphics', exact: true }).click();
  const initial = await visiblePanel();
  for (let i = 0; i < 8; i++) {
    await page.getByRole('button', { name: i % 2 ? '显示网格' : '显示坐标轴', exact: true }).click();
    assert.equal(await visiblePanel(), initial);
    await verifySync('3D');
  }
  await page.screenshot({ path: new URL('3d.png', directory).pathname.replace(/^\/(\w:)/, '$1'), fullPage: false });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ mode: '3D', panel: initial, clicks: 8, visible: true, sync: true, pageErrors: errors }));
} finally {
  await browser.close();
}
