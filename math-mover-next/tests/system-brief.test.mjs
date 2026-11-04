import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { buildSystemBrief, resetSystemBriefCache } = await import(
  new URL('../lib/server/system-brief.ts', import.meta.url).href
);
const { workspaceDir, constructionPath } = await import(
  new URL('../lib/server/workspace.ts', import.meta.url).href
);

test('简报含通用写法 + 命令表 + 卡片目录（原 get_drawing_pack 的内容）', () => {
  resetSystemBriefCache();
  const brief = buildSystemBrief(REPO_ROOT);
  // 通用写法（来自 skills/shared/ggb-basics.md）
  assert.match(brief, /MODE: 2D/);
  // 命令白名单（2D+3D 全列，不按类别裁剪）
  assert.match(brief, /3D 构造命令/);
  // 写法卡目录——18 张全库
  assert.match(brief, /写法卡目录/);
  assert.match(brief, /intersection/);
  assert.match(brief, /3d-frame/);
});

test('首轮简报直接带正确斜率写法和计算对象创建时隐藏的规则', () => {
  resetSystemBriefCache();
  const brief = buildSystemBrief(REPO_ROOT);
  assert.ok(brief.includes('不要写 `Slope(A, P)`'));
  assert.ok(brief.includes('lineAP = Line(A, P)'));
  assert.ok(brief.includes('kAP = Slope(lineAP)'));
  assert.ok(brief.includes('纯计算对象创建时就隐藏'));
  assert.ok(brief.includes('与定义放在同一次 `ggb_apply`'));
  assert.ok(brief.includes('要求显示的数值/动态文字保持可见'));
});

test('简报带防回声标签：稳定前缀 + 不许复述', () => {
  const brief = buildSystemBrief(REPO_ROOT);
  assert.match(brief, /<mathmover_core_system_prompt>[\s\S]*<\/mathmover_core_system_prompt>/);
  assert.match(brief, /不要引用、复述或转述/);
  // 用户原话要占「最近位置」，故标签闭合后只留防回声句
  const after = brief.split('</mathmover_core_system_prompt>')[1];
  assert.ok(after.length < 120, `标签后只应有防回声句，实际 ${after.length} 字符`);
});

test('简报逐字节稳定（prompt cache 要靠前缀命中）', () => {
  resetSystemBriefCache();
  const a = buildSystemBrief(REPO_ROOT);
  const b = buildSystemBrief(REPO_ROOT);
  assert.equal(a, b);
});

test('简报不再提已删的兜底工具（write_construction 随自研 BYOK 循环一起删了）', () => {
  // 内置位换成自带分发的 OpenCode 之后，所有运行时都自带文件能力 ⇒
  // 简报里不该再出现那对只在 BYOK 面前注册过的工具名（提了 agent 会去找不存在的工具）。
  const brief = buildSystemBrief(REPO_ROOT);
  assert.ok(!brief.includes('write_construction'), '工作稿读写工具已删，简报不得再提');
  assert.ok(!brief.includes('read_construction'), '工作稿读写工具已删，简报不得再提');
});

test('题目增强只认题图：不把「文字题面」当触发条件', () => {
  // 触发键必须是宿主可判定的机械事实（本轮带没带题图）。写成「图片/题面」时，
  // 「画一个正方体，边长为1」会被读成题面而误取增强——实测就是这么发生的。
  const brief = buildSystemBrief(REPO_ROOT);
  assert.match(brief, /带了题目图片/);
  assert.match(brief, /直接指令/);
  assert.ok(!brief.includes('图片/题面'), '旧的宽触发措辞不得回潮：纯文字题面不算');
});

test('题图一次拿齐固定 SOP，普通画图仍可按需取卡', () => {
  const brief = buildSystemBrief(REPO_ROOT);
  assert.match(brief, /一次返回完整的 8 步建模流程 \+ 本类固定清单中的全部 SOP 正文/);
  assert.match(brief, /已包含的卡不要重复取/);
  assert.match(brief, /普通画图或需要包内未包含的补充参考时，用 get_sop_cards 按需批量取卡/);
  assert.ok(!brief.includes('清单只是目录'));
});

test('按完整构造阶段提交，必要样式随对象创建一起确定', () => {
  const brief = buildSystemBrief(REPO_ROOT);
  assert.match(brief, /创建对象时，一并确定必要的标签、颜色、点大小和辅助对象显隐/);
  assert.match(brief, /沿用默认值时不补写样式命令/);
  assert.match(brief, /简单图形可一次提交完整构造/);
  assert.match(brief, /复杂图形按「基础图形」「动点与关联对象」等完整阶段更新/);
  assert.match(brief, /不按单个对象或样式属性拆批/);
  assert.doesNotMatch(brief, /每完成一段就|不要憋到最后一次性出全图/);
});

test('检查后集中修正并明确结束条件，真实错误仍必须修复', () => {
  const brief = buildSystemBrief(REPO_ROOT);
  assert.match(brief, /将已发现的问题集中修改后再 apply/);
  assert.match(brief, /回执点名了无效行、或动点自洽未过，就得改掉再收工/);
  assert.match(brief, /对象缺失、对应关系或运动边界错误也必须修复，不硬性限制修正次数/);
  assert.match(brief, /构造完整、依赖正确、运动符合题意、画面可读且自检通过后，直接输出结果/);
  assert.match(brief, /不要为轻微外观差异再开一轮美化/);
  assert.match(brief, /用户明确要求的外观修改或影响可读性的视图问题仍应处理/);
});

test('线框画法统一：一步到位构造器不用（所有场景都拿到这条）', () => {
  // 多轮微调是常态：第一轮用 Cube(A,B) 省事，第二轮「在这条棱上加个动点」就给不出
  // 可引用的棱对象。规则落在共同输出约定里，自由画图同样受约束。
  const brief = buildSystemBrief(REPO_ROOT);
  assert.match(brief, /不要用 `Cube`/);
  assert.match(brief, /3d-edges/);
});

test('简报不再含 get_drawing_pack（内容已内联，工具已删）', () => {
  const brief = buildSystemBrief(REPO_ROOT);
  assert.ok(!brief.includes('get_drawing_pack'));
});

test('简报不含绝对路径（会破坏 cache 前缀）；工作区按课件而异、落在数据目录下', () => {
  const brief = buildSystemBrief(REPO_ROOT);
  // 简报要字节级稳定，路径含课件 id，不能混进去
  assert.ok(!brief.includes('workspaces'), '稳定简报不该含每课件的路径');

  // 沙箱在数据目录下（用户数据归数据目录、软件归软件），每课件一份
  const id = '3f2a9c10-8e1b-4c7d-9a2f-0b6e5d4c3b2a';
  assert.match(workspaceDir(id), /workspaces[/\\]3f2a9c10-8e1b-4c7d-9a2f-0b6e5d4c3b2a$/);
  assert.match(constructionPath(id), /workspaces[/\\]3f2a9c10-8e1b-4c7d-9a2f-0b6e5d4c3b2a[/\\]construction\.ggb\.txt$/);
  // 无课件 id 时落 _default 兜底，不会与任何课件串
  assert.match(workspaceDir(undefined), /workspaces[/\\]_default$/);
});
