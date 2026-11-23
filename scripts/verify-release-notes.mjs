import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// No real preferences, model calls, courseware writes or updater installation.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
async function fixture(onboarding = false, theme = 'light') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ onboarding, theme }) => {
    localStorage.setItem('mm.theme', theme);
    window.mathmoverDesktop = {
      isDesktop: true,
      getVersion: async () => '0.0.10',
      getReleaseNotesState: async () => {
        const seenVersion = sessionStorage.getItem('release-notes-fixture');
        return { version: '0.0.10', seenVersion, onboarding, shouldShow: !onboarding && seenVersion !== '0.0.10' };
      },
      acknowledgeReleaseNotes: async version => { sessionStorage.setItem('release-notes-fixture', version); },
    };
  }, { onboarding, theme });
  await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [] } }));
  await page.route('**/api/byok', route => route.fulfill({ json: { apiFormat: 'openai-responses', baseUrl: '', model: '', reasoningLevels: '', apiKeyConfigured: false, apiKeyTail: '' } }));
  await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [], bindingToken: 'fixture' } }));
  await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
  await stubConstructionDraft(page);
  return page;
}

try {
  const page = await fixture();
  await page.goto('http://127.0.0.1:3000/dashboard');
  const notes = page.locator('[data-slot="release-notes-dialog"]');
  await notes.waitFor({ state: 'visible' });
  assert.equal(await notes.getByRole('heading', { name: 'v0.0.10', exact: true }).count(), 1);
  await notes.screenshot({ path: 'spike-out/release-notes-light.png' });
  const darkPage = await fixture(false, 'dark');
  await darkPage.goto('http://127.0.0.1:3000/dashboard');
  const darkNotes = darkPage.locator('[data-slot="release-notes-dialog"]');
  await darkNotes.waitFor({ state: 'visible' });
  await darkPage.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await darkNotes.screenshot({ path: 'spike-out/release-notes-dark.png' });
  await darkPage.setViewportSize({ width: 520, height: 760 });
  await darkPage.waitForFunction(() => {
    const bounds = document.querySelector('[data-slot="release-notes-dialog"]').getBoundingClientRect();
    return bounds.width <= innerWidth - 30 && bounds.x >= 0;
  });
  await darkNotes.screenshot({ path: 'spike-out/release-notes-compact.png' });
  const bounds = await darkNotes.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 520, JSON.stringify(bounds));
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 760);
  await darkPage.close();
  await notes.getByRole('button', { name: '知道了', exact: true }).click();
  await notes.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => sessionStorage.getItem('release-notes-fixture')), '0.0.10');
  await page.reload();
  await page.waitForTimeout(1300);
  assert.equal(await notes.count(), 0, 'acknowledged version must not auto-open');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '关于', exact: true }).click();
  const trigger = settings.getByRole('button', { name: '更新记录', exact: true });
  await trigger.click();
  await notes.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await notes.waitFor({ state: 'hidden' });
  assert.equal(await settings.isVisible(), true, 'Escape closes only the nested notes');
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '更新记录');

  const firstInstall = await fixture(true);
  await firstInstall.goto('http://127.0.0.1:3000/dashboard?onboarding=1');
  await firstInstall.getByRole('dialog', { name: '设置', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await firstInstall.locator('[data-slot="release-notes-dialog"]').count(), 0);
  assert.equal(await firstInstall.evaluate(() => sessionStorage.getItem('release-notes-fixture')), '0.0.10');
  assert.deepEqual(errors, []);
  console.log('PASS: automatic display, acknowledgement, reload, manual history, nested Escape/focus, onboarding, light/dark/compact layout');
} finally {
  await browser.close();
}
