import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

// Isolated APIs: no real config writes, courseware deletion or CLI invocation.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const compact = process.argv.includes('--compact');
const page = await browser.newPage({
  viewport: compact ? { width: 910, height: 512 } : { width: 1544, height: 900 },
  colorScheme: compact ? 'dark' : 'light',
});
page.setDefaultTimeout(10_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [] } }));
await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.route('**/api/coursewares**', route => route.fulfill({ json: { records: [], bindingToken: 'fixture' } }));
await page.routeWebSocket('ws://127.0.0.1:8787', socket => socket.onMessage(() => {}));
await stubConstructionDraft(page);
try {
  await page.goto('http://localhost:3000/dashboard?action=new');
  const trigger = page.getByRole('button', { name: '设置', exact: true });
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  for (const mode of ['fresh', 'theme']) {
    if (mode === 'fresh') await page.evaluate(() => {
      // Freeze the actual CSS animation at mount; a settled screenshot misses drift.
      const observer = new MutationObserver(() => {
        const el = document.querySelector('[data-slot=settings-dialog]');
        if (!el) return;
        const animation = el.getAnimations()[0];
        if (!animation) return;
        animation.pause();
        window.settingsEntryAnimation = animation;
        observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await trigger.click();
    await dialog.waitFor();
    if (mode === 'fresh') {
      await page.waitForFunction(() => !!window.settingsEntryAnimation);
      const frames = await dialog.evaluate(el => {
        const animation = window.settingsEntryAnimation;
        const duration = animation.effect.getTiming().duration;
        const frames = [0, 0.25, 0.5, 1].map(progress => {
          animation.currentTime = Number(duration) * progress;
          const rect = el.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, opacity: Number(getComputedStyle(el).opacity) };
        });
        animation.finish();
        return { frames, width: innerWidth, height: innerHeight };
      });
      for (const frame of frames.frames) {
        assert(Math.abs(frame.x - frames.width / 2) < 1, `entry stays horizontally centered: ${JSON.stringify(frames)}`);
        assert(Math.abs(frame.y - frames.height / 2) < 1, `entry stays vertically centered: ${JSON.stringify(frames)}`);
      }
      assert.equal(frames.frames[0].opacity, 0);
      assert.equal(frames.frames.at(-1).opacity, 1);
    }
    await page.waitForTimeout(250);
    if (mode === 'theme') {
      await dialog.getByRole('button', { name: '外观', exact: true }).click();
      await dialog.getByRole('button', { name: /^主题模式/ }).click();
      await page.getByRole('menu').waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('menu').waitFor({ state: 'detached' });
    }
    await page.mouse.click(5, 300);
    await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '设置');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: entry fades in at screen center without diagonal drift; first backdrop click closes fresh Settings and Settings after theme-menu Escape; focus restores on repeated opening.');
} finally { await browser.close(); }
