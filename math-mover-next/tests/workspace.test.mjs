import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { workspaceDir, constructionPath, ensureConstructionDraft, ensureMcpConfig, resetMcpConfigCache } = await import(
  new URL('../lib/server/workspace.ts', import.meta.url).href
);

test('MCP 配置用绝对路径——换 cwd 也指向同一处', () => {
  resetMcpConfigCache();
  const file = ensureMcpConfig(REPO_ROOT, 'http://127.0.0.1:8788');
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  const server = cfg.mcpServers.mathmover;

  // args 必须是绝对路径：agent 的 cwd 是每窗口沙箱，相对路径会指到不存在的地方
  assert.ok(path.isAbsolute(server.args[0]), `args 应为绝对路径，实际 ${server.args[0]}`);
  assert.match(server.args[0], /mcp-stdio\.ts$/);

  // 配置写在 mcp/ 目录下：dsh 用 dirname(mcpConfigPath) 找 patch 文件
  assert.match(file, /packages[/\\]daemon[/\\]mcp[/\\]runtime-mcp\.json$/);
});

test('command 用 process.execPath——不依赖 PATH，换机器不会找不到 node', () => {
  resetMcpConfigCache();
  const file = ensureMcpConfig(REPO_ROOT, 'http://127.0.0.1:8788');
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  // PATH 上没有 node 时（nvm 切版本、非标准安装）`command: "node"` 会起不来
  assert.equal(cfg.mcpServers.mathmover.command, process.execPath);
  assert.ok(path.isAbsolute(cfg.mcpServers.mathmover.command));
});

test('沙箱每**课件**一份、落在数据目录下；无课件 id 时落 _default', () => {
  const id = '3f2a9c10-8e1b-4c7d-9a2f-0b6e5d4c3b2a';
  assert.match(workspaceDir(id), /workspaces[/\\]3f2a9c10-8e1b-4c7d-9a2f-0b6e5d4c3b2a$/);
  assert.match(constructionPath(id), /workspaces[/\\]3f2a9c10-8e1b-4c7d-9a2f-0b6e5d4c3b2a[/\\]construction\.ggb\.txt$/);
  // 无课件 id 时落 _default 兜底（与 daemon 同一套规则），不引入第二套命名
  assert.match(workspaceDir(undefined), /workspaces[/\\]_default$/);
  assert.match(workspaceDir(''), /workspaces[/\\]_default$/);
  // 这个值要当目录名用——不合法的一律兜底，绝不拼出 `workspaces//` 或越界路径
  assert.match(workspaceDir('../../escape'), /workspaces[/\\]_default$/);
  assert.match(workspaceDir('a/b'), /workspaces[/\\]_default$/);
});

test('预建空工作稿：agent 第一轮读得到，且绝不覆盖已有草稿', () => {
  // agent 先 Read 再改，新课件没有这份文件时它第一轮就吃一个失败（实测白烧一次调用）
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-draft-test-'));
  const previous = process.env.MATHMOVER_DATA_DIR;
  process.env.MATHMOVER_DATA_DIR = dir;
  try {
    const file = ensureConstructionDraft('course-1');
    assert.equal(readFileSync(file, 'utf8'), '', '新建的是空文件');
    assert.ok(existsSync(path.dirname(file)), '沙箱目录一并建好（第一次发消息时还不存在）');

    writeFileSync(file, 'A = (0, 0)\n');
    ensureConstructionDraft('course-1');
    assert.equal(readFileSync(file, 'utf8'), 'A = (0, 0)\n', '已有草稿一个字都不能动');

    // 无课件 id 时同样落 _default，不抛错
    assert.equal(readFileSync(ensureConstructionDraft(undefined), 'utf8'), '');
  } finally {
    if (previous === undefined) delete process.env.MATHMOVER_DATA_DIR;
    else process.env.MATHMOVER_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('同一次进程内配置只写一次（记忆化）', () => {
  resetMcpConfigCache();
  const a = ensureMcpConfig(REPO_ROOT, 'http://127.0.0.1:8788');
  const b = ensureMcpConfig('/some/other/root', 'http://example.com');
  assert.equal(a, b, '记忆化后应返回同一路径，不重复写盘');
});
