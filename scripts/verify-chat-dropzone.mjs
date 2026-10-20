/**
 * 拖入区 = **整个对话区**（不只是输入框）的回归。
 *
 * 守什么：`ComposerPrimitive.AttachmentDropzone` 包住对话区之后，
 *   ① 往**消息区**（空状态/消息列表这些深处的元素）拖一张图，也能落成待发送附件；
 *   ② 拖拽期间整块区域给提示（`data-dragging="true"` + 蒙层），松手后消失；
 *   ③ 拖**非文件**（页面里选中的文字）不点亮蒙层——否则一动鼠标就闪；
 *   ④ 落进来的是**待发送附件**，不会被立刻发出去。
 *
 * 为什么值得守：接库之前全仓库只有输入框一个 drop 目标，拖到别处没有任何 preventDefault，
 * 浏览器会按默认行为**导航到那个文件**、把整页顶掉。而且这个区域覆盖空状态那句
 * 「输入题目或上传题图」——用户的心智模型本来就是「这块地方放题目」。
 *
 * 运行：node scripts/verify-chat-dropzone.mjs [baseUrl]
 * 隔离：夹具课件、Agent 只回 GET、daemon socket 只拦不转发——不碰真课件库与实时会话。
 */

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { stubConstructionDraft } from './lib/stub-construction.mjs';

const base = process.argv[2] || 'http://localhost:3000';
const ID = 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0';
const record = {
  id: ID, title: '拖入区验证', revision: 1, archived_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  commands: ['A = (1, 2)', 'B = (3, 2)', 'f = Segment(A, B)'],
  // 带一条消息，这样消息列表（而不是空状态）会渲染出来——拖入要覆盖的正是它
  messages: [{ id: `${ID}-user`, role: 'user', content: '先画一条线段', createdAt: Date.now() }],
  view: { showAxes: true, showGrid: true },
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
page.setDefaultTimeout(20_000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/agent**', (route) => {
  assert.equal(route.request().method(), 'GET', '落进输入框的图不该被发出去');
  return route.fulfill({ json: { runtimes: [{ id: 'fixture', name: '测试 Agent', usable: true, version: 'fixture', canAttachImages: true }] } });
});
await page.route('**/api/byok', (route) => route.fulfill({ json: { apiKeyConfigured: false } }));
await page.routeWebSocket('ws://127.0.0.1:8787', (socket) => socket.onMessage(() => {}));
await page.route('**/api/coursewares**', (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/windows')) return route.fulfill({ json: { bindingToken: 'fixture-ticket' } });
  if (route.request().method() === 'GET') {
    return route.fulfill({ json: url.pathname.endsWith(ID) ? record : { records: [record], capabilities: { archive: true, permanentDelete: true } } });
  }
  return route.fulfill({ json: record });
});
await stubConstructionDraft(page, { commands: record.commands });

/** 造一个带真文件的 DataTransfer（Playwright 的 dispatchEvent 认这个句柄）。 */
const transfer = (page, files) => page.evaluateHandle((specs) => {
  const dt = new DataTransfer();
  for (const spec of specs) {
    const binary = atob(spec.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    dt.items.add(new File([bytes], spec.name, { type: spec.type }));
  }
  return dt;
}, files);
const dragEvents = async (target, dt, types = ['dragenter', 'dragover', 'drop']) => {
  for (const type of types) await target.dispatchEvent(type, { dataTransfer: dt });
};
const chipCount = () => page.locator('[aria-label=待发送图片] img').count();
const overlay = page.getByText('把题图拖到这里', { exact: true });

try {
  await page.goto(`${base}/dashboard?history_id=${ID}`, { timeout: 90_000 });
  await page.getByRole('button', { name: '重命名课件：拖入区验证', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-slot=board-interaction-guard]'));

  const zone = page.locator('[aria-label="题目图片放置区"]');
  await zone.waitFor();
  // 这一层必须**包住消息区**，不然「拖到消息上」还是会落到浏览器的默认行为
  assert.equal(await zone.locator('[aria-label=聊天消息]').count(), 1, '对话区那一层把消息区包在里面');
  assert.equal(await zone.locator('[aria-label=题目输入区]').count(), 1, '也包住输入框（同一个区，不是两个）');
  // 标题行也得在里面：那 56px 漏在外面的话，拖上去还是会落到浏览器的默认行为
  assert.equal(await zone.locator('span[aria-label="当前 Agent：测试 Agent"]').count(), 1, '标题行也在拖入区里');

  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 24;
    canvas.getContext('2d').fillRect(0, 0, 24, 24);
    return canvas.toDataURL().split(',')[1];
  });
  const file = (name) => [{ name, type: 'image/png', base64: png }];

  // ① 拖拽中：整块区域给提示
  const dt = await transfer(page, file('拖到消息上的题图.png'));
  await page.locator('[aria-label=聊天消息]').dispatchEvent('dragenter', { dataTransfer: dt });
  await page.locator('[aria-label=聊天消息]').dispatchEvent('dragover', { dataTransfer: dt });
  await page.waitForFunction(() => document.querySelector('[aria-label="题目图片放置区"]')?.getAttribute('data-dragging') === 'true');
  await overlay.waitFor();
  // 落一张拖拽中的样子：观感这种事只能看（spike-out 已在 .gitignore）
  await mkdir('spike-out', { recursive: true });
  await page.screenshot({ path: 'spike-out/chat-dropzone.png' });

  // ② 松手在**消息正文**上（不是输入框）——必须落成待发送附件
  await page.locator('[aria-label=聊天消息]').dispatchEvent('drop', { dataTransfer: dt });
  await page.waitForFunction(() => document.querySelectorAll('[aria-label=待发送图片] img').length === 1);
  // 蒙层是**常驻 DOM、靠 data-dragging 切显隐**（纯 CSS，不额外渲染），所以判可见性不判数量
  await overlay.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[aria-label="题目图片放置区"]').getAttribute('data-dragging'), null, '松手后不再处于拖拽态');

  // ③ 同一层也覆盖输入框：拖到输入框上照样进（一个区，两处都能落）
  const dt2 = await transfer(page, file('拖到输入框的题图.png'));
  await dragEvents(page.locator('[aria-label=题目描述]'), dt2);
  await page.waitForFunction(() => document.querySelectorAll('[aria-label=待发送图片] img').length === 2);

  // ④ 拖**非文件**（页面里选中的文字）不该点亮蒙层——否则鼠标一动就闪
  await page.locator('[aria-label=聊天消息]').dispatchEvent('dragenter', {
    dataTransfer: await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '选中的一段文字');
      return dt;
    }),
  });
  await page.waitForTimeout(200);
  assert.equal(await overlay.isVisible(), false, '拖文字不点亮拖入提示');

  // ⑤ 粘贴这条也顺手守住：入口刚换成库的 `addAttachmentOnPaste`，别处没有覆盖。
  // 注意 `clipboardData` 是只读属性，Playwright 的 `dispatchEvent` 塞不进去，
  // 得在页面里 new 一个真的 ClipboardEvent。
  await page.evaluate((base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], '粘贴的题图.png', { type: 'image/png' }));
    document.querySelector('[aria-label=题目描述]').dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, png);
  await page.waitForFunction(() => document.querySelectorAll('[aria-label=待发送图片] img').length === 3);

  assert.equal(await page.locator('[aria-label=待发送图片] img').count(), 3, '三张都在待发送区、没有发出去');
  assert.deepEqual(errors, []);
  console.log('PASS: 拖入区覆盖整个对话区 —— 拖到消息正文、拖到输入框、粘贴三条入口都落成待发送附件（3 张）、拖拽中整块区域提示、松手即收、拖文字不误触；0 浏览器错误。');
} finally {
  await browser.close();
}
