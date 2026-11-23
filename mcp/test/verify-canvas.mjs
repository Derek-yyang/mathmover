import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'mathmover-mcp-canvas-'));
const output = path.join(root, '.test-output');
await fs.mkdir(output, { recursive: true });
const errors = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let client;
async function connect() {
  client = new Client({ name: 'workbuddy-compatible-host', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/cli.cjs'), '--data-dir', data], stderr: 'pipe', cwd: os.tmpdir() });
  transport.stderr?.on('data', bytes => process.stderr.write(bytes));
  await client.connect(transport);
}
async function open(args = {}) {
  const result = await client.callTool({ name: 'mathmover_open_canvas', arguments: args });
  assert.ok(!result.isError, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}
async function tool(name, canvas) {
  const result = await client.callTool({ name, arguments: { session_id: canvas.session_id } }, undefined, { timeout: 90000 });
  assert.ok(!result.isError, JSON.stringify(result));
  return result;
}
async function pageFor(canvas) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(canvas.url);
  await page.locator('[data-connected="true"]').waitFor({ timeout: 60000 });
  return page;
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const sessionId = decodeURIComponent(location.pathname.split('/').pop() ?? '');
    const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok ? (await response.json()).snapshot : null;
  });
}
async function waitForAutosave(page, previous) {
  await page.waitForFunction(async previous => {
    const sessionId = decodeURIComponent(location.pathname.split('/').pop() ?? '');
    const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return false;
    const current = (await response.json()).snapshot;
    return Boolean(current && current !== previous);
  }, previous, { timeout: 15000 });
}

try {
  await connect();
  const first = await open({ title: '椭圆与动点' });
  const appResource = await client.readResource({ uri: (await client.listResources()).resources[0].uri });
  const appPage = await browser.newPage({ viewport: { width: 980, height: 760 }, deviceScaleFactor: 1 });
  appPage.on('pageerror', error => {
    errors.push(error.message);
    console.log(`[mcp-app:pageerror] ${error.message}`);
  });
  await appPage.setContent(appResource.contents[0].text);
  await appPage.evaluate(({ url, title }) => {
    window.postMessage({
      jsonrpc: '2.0',
      id: 'mathmover-1',
      result: {
        protocolVersion: '2026-01-26',
        hostInfo: { name: 'MathMover test host', version: '1' },
        hostCapabilities: {},
        hostContext: { displayMode: 'panel', theme: 'light' },
      },
    }, '*');
    setTimeout(() => window.postMessage({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: { structuredContent: { url, title, connected: true } },
    }, '*'), 50);
  }, { url: first.url, title: first.title });
  await appPage.frameLocator('#canvas').locator('[data-connected="true"]').waitFor({ timeout: 60000 });
  await appPage.screenshot({ path: path.join(output, 'mcp-app-panel.png') });
  await appPage.close();

  const page = await pageFor(first);
  const base = ['MODE:2D', 'E: x^2/9+y^2=1', 'A=(-3,0)', 'B=(3,0)', 'P=Point(E)', 'SetColor(E,"#047857")', 'SetColor(P,"#047857")', 'SetPointSize(P,5)'];
  await fs.writeFile(first.workfile, base.join('\n') + '\n');
  const initial = await tool('ggb_apply', first);
  assert.ok(initial.content.some(item => item.type === 'image' && item.data.length > 100));
  assert.equal(await page.evaluate(() => window.ggbApplet.getColor('E')), '#047857');
  await fs.writeFile(path.join(output, 'tool-state.png'), Buffer.from(initial.content.find(item => item.type === 'image').data, 'base64'));
  assert.equal(await page.evaluate(() => window.ggbApplet.exists('P')), true);
  assert.equal(await page.locator('textarea').count(), 0);
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).count(), 0);
  await page.screenshot({ path: path.join(output, 'canvas-2d.png') });
  const before = await page.evaluate(() => [window.ggbApplet.getXcoord('P'), window.ggbApplet.getYcoord('P')]);

  // End the host task while keeping the board open. Interaction and saving
  // must continue through the detached local canvas service.
  await client.close();
  client = undefined;
  await page.locator('[data-connected="true"]').waitFor({ timeout: 15000 });
  const beforeDragSnapshot = await snapshot(page);
  await page.evaluate(() => {
    const api = window.ggbApplet;
    api.setCoords('P', 2.6, .5);
    api.updateConstruction?.();
  });
  assert.notDeepEqual(await page.evaluate(() => [window.ggbApplet.getXcoord('P'), window.ggbApplet.getYcoord('P')]), before);
  await waitForAutosave(page, beforeDragSnapshot);
  // WorkBuddy may present the URL again on completion. The new visible
  // preview must own the bridge; the retired view must not retry and steal it.
  const preview = await pageFor(first);
  await page.getByRole('button', { name: '在此继续', exact: true }).waitFor();
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.equal(await preview.locator('[data-connected="true"]').count(), 1);
  await preview.close();
  await page.getByRole('button', { name: '在此继续', exact: true }).click();
  await page.locator('[data-connected="true"]').waitFor({ timeout: 60000 });
  await connect();
  const changed = await tool('ggb_get_state', first);
  assert.ok(changed.content.some(item => item.type === 'text' && item.text.includes('P')));
  const after = await page.evaluate(() => [window.ggbApplet.getXcoord('P'), window.ggbApplet.getYcoord('P')]);
  assert.notDeepEqual(before, after);
  await page.reload();
  await page.locator('[data-connected="true"]').waitFor({ timeout: 60000 });
  assert.equal(await page.evaluate(() => window.ggbApplet.exists('E')), true);
  assert.ok(Math.abs(await page.evaluate(() => window.ggbApplet.getXcoord('P')) - after[0]) < .01);
  await page.getByRole('button', { name: '课件', exact: true }).click();
  await page.locator('.library-panel').waitFor();
  assert.equal(await page.getByText('课件保存在本机，可随时重新打开。', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '收起课件栏', exact: true }).click();
  await page.locator('.library-panel').waitFor({ state: 'hidden' });
  await page.getByLabel('导出课件', { exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 图片', exact: true }).click();
  const download = await downloading;
  assert.ok(download.suggestedFilename().endsWith('.png'));
  await page.getByLabel('导出课件', { exact: true }).click();

  // Read/Edit remains the only construction entry, including invalid drafts.
  await fs.writeFile(first.workfile, [...base, 'NonsenseFunction(1)'].join('\n') + '\n');
  const invalid = await client.callTool({ name: 'ggb_apply', arguments: { session_id: first.session_id, png: false } }, undefined, { timeout: 90000 });
  assert.match(JSON.stringify(invalid), /NonsenseFunction/);
  assert.match(await fs.readFile(first.workfile, 'utf8'), /NonsenseFunction/);
  const beforeResetSnapshot = await snapshot(page);
  await fs.writeFile(first.workfile, base.join('\n') + '\n');
  await tool('ggb_apply', first);
  await waitForAutosave(page, beforeResetSnapshot);

  const second = await open({ title: '空间图形' });
  const space = await pageFor(second);
  await fs.writeFile(second.workfile, 'MODE:3D\nO=(0,0,0)\nU=(2,0,0)\nV=(0,2,0)\nW=(0,0,2)\np=Polygon(O,U,V)\ns=Pyramid(p,W)\n');
  await tool('ggb_apply', second);
  assert.equal(await space.evaluate(() => window.ggbApplet.exists('W')), true);
  assert.equal(await page.evaluate(() => window.ggbApplet.exists('W')), false);
  await space.screenshot({ path: path.join(output, 'canvas-3d.png') });
  await page.setViewportSize({ width: 540, height: 760 });
  await page.screenshot({ path: path.join(output, 'canvas-narrow.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  await page.close();
  await space.close();
  const disconnected = await client.callTool({ name: 'ggb_get_state', arguments: { session_id: first.session_id, png: false } });
  assert.equal(disconnected.isError, true);
  await client.close();
  await connect();
  const reopened = await open({ session_id: first.session_id });
  assert.equal(reopened.workfile, first.workfile);
  const restored = await pageFor(reopened);
  assert.equal(await restored.evaluate(() => window.ggbApplet.exists('E')), true);
  await restored.close();
  assert.deepEqual(errors, []);
  console.log('PASS: stdio → local workfile → real 2D/3D canvas → state/image/audit → snapshot save/reload → isolated sessions → service restart restore');
} finally {
  await browser.close();
  await client?.close();
  try {
    const info = JSON.parse(await fs.readFile(path.join(data, 'daemon.json'), 'utf8'));
    await fetch(`${info.origin}/api/control/shutdown`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${info.controlToken}` },
    });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        process.kill(info.pid, 0);
      } catch {
        break;
      }
      try {
        await fetch(`${info.origin}/api/control/health`, {
          headers: { Authorization: `Bearer ${info.controlToken}` },
        });
      } catch {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch {
    // The verifier may stop before the daemon starts.
  }
  await fs.rm(data, { recursive: true, force: true });
}
