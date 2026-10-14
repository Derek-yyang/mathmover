import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { buildSystemBrief, resetSystemBriefCache } = await import(
  new URL('../lib/server/system-brief.ts', import.meta.url).href
);

test('简报含通用写法 + 命令表 + 卡片目录（原 get_drawing_pack 的内容）', () => {
  resetSystemBriefCache();
  const brief = buildSystemBrief(REPO_ROOT, 'cli');
  // 通用写法（来自 skills/shared/ggb-basics.md）
  assert.match(brief, /MODE: 2D/);
  // 命令白名单（2D+3D 全列，不按类别裁剪）
  assert.match(brief, /3D 构造命令/);
  // 写法卡目录——18 张全库
  assert.match(brief, /写法卡目录/);
  assert.match(brief, /intersection/);
  assert.match(brief, /3d-frame/);
});

test('简报带防回声标签：稳定前缀 + 不许复述', () => {
  const brief = buildSystemBrief(REPO_ROOT, 'cli');
  assert.match(brief, /<mathmover_core_system_prompt>[\s\S]*<\/mathmover_core_system_prompt>/);
  assert.match(brief, /不要引用、复述或转述/);
  // 用户原话要占「最近位置」，故标签闭合后只留防回声句
  const after = brief.split('</mathmover_core_system_prompt>')[1];
  assert.ok(after.length < 120, `标签后只应有防回声句，实际 ${after.length} 字符`);
});

test('简报逐字节稳定（prompt cache 要靠前缀命中）', () => {
  resetSystemBriefCache();
  const a = buildSystemBrief(REPO_ROOT, 'cli');
  const b = buildSystemBrief(REPO_ROOT, 'cli');
  assert.equal(a, b);
});

test('byok 面多一段文件读写工具说明，cli 面没有', () => {
  const cli = buildSystemBrief(REPO_ROOT, 'cli');
  const byok = buildSystemBrief(REPO_ROOT, 'byok');
  assert.match(byok, /write_construction/);
  assert.ok(!cli.includes('write_construction'), '真 CLI 自带 Read/Edit，简报不该提兜底工具');
});

test('简报不再含 get_drawing_pack（内容已内联，工具已删）', () => {
  const brief = buildSystemBrief(REPO_ROOT, 'cli');
  assert.ok(!brief.includes('get_drawing_pack'));
});
