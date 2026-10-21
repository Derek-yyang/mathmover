/**
 * 工作稿目录的键是**课件 id**，不是窗口 id。
 *
 * 这几处是「接线」，错了不会报错、只会悄悄退化回旧行为（按窗口命名目录，
 * 于是每次启动应用多一个没人清的目录）。所以在这里钉住：
 *  ① `flush()` 必须把课件 id 交出来——它建记录时用的就是那个 id；
 *  ② 发送时把它给后端，且**不得**退回窗口 id（那正是这次要消除的东西）；
 *  ③ 重连时重灌草稿——daemon 启动会清孤儿工作区，不补这一下就只剩空文件。
 *
 * hook 本体是 React 组件，起不了渲染环境，故按源码接线断言（同 sidebar-motion）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const hook = read('../hooks/useCoursewareLibrary.ts');
// 桌面版把 page.tsx 拆成“服务端入口 + 客户端组件”，页面接线在 DashboardClient 里
const page = read('../app/dashboard/DashboardClient.tsx');
const route = read('../app/api/agent/route.ts');
const proxy = read('../lib/server/construction-proxy.ts');

test('flush 交出课件 id（就是建记录时那个）', () => {
  assert.match(hook, /const current = record\.current;/);
  assert.match(hook, /return current\.id;/);
  // 返回类型跟着放宽，否则调用方拿不到 id
  assert.match(hook, /flushRef = useRef<\(messages\?: AgentChatMessage\[\]\) => Promise<string \| undefined>>/);
});

test('发送时把课件 id 给后端，且不退回窗口 id', () => {
  assert.match(page, /const coursewareId = await flush\(nextMessages\);/);
  assert.match(page, /body: JSON\.stringify\(\{\s*text,\s*windowId,\s*coursewareId,/);
  // 退回窗口 id 等于把「按窗口命名目录」放回来——正是这次要消除的
  assert.doesNotMatch(page, /coursewareId\s*(\?\?|\|\|)\s*windowId/);
});

test('重连时重灌草稿（回收敢放手删的前提）', () => {
  const heal = page.slice(page.indexOf('onConnectionChange:'));
  assert.match(heal, /if \(status === 'connected'\)[\s\S]{0,300}syncConstructionDraft\(ledgerRef\.current, id\)/);
});

test('课件 id 由请求体传入，并转成 agent 的环境变量；同步草稿走课件头', () => {
  assert.match(route, /coursewareId\?: string;/);
  assert.match(route, /workspaceDir\(coursewareKey\)/);
  assert.match(route, /MATHMOVER_COURSEWARE_ID: coursewareKey \?\? ''/);
  assert.match(proxy, /'x-mathmover-courseware'/);
  // 工作稿路径必须报给 agent（它靠这一行知道往哪写），且按课件算
  assert.match(route, /const pathLine = `工作稿路径：\$\{constructionPath\(coursewareKey\)\}/);
});
