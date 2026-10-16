import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { workspaceDir, constructionPath, ensureMcpConfig, resetMcpConfigCache } = await import(
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

test('同一次进程内配置只写一次（记忆化）', () => {
  resetMcpConfigCache();
  const a = ensureMcpConfig(REPO_ROOT, 'http://127.0.0.1:8788');
  const b = ensureMcpConfig('/some/other/root', 'http://example.com');
  assert.equal(a, b, '记忆化后应返回同一路径，不重复写盘');
});
