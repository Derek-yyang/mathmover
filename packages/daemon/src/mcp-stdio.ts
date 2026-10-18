#!/usr/bin/env node
/**
 * 独立 MCP stdio 服务 —— 供 agent CLI（Claude Code / Codex / dsh）经 --mcp-config 拉起。
 *
 * 链路：
 *   agent CLI ──stdio──▶ 本进程 ──HTTP──▶ daemon(127.0.0.1) ──WS──▶ 页面活画布
 *
 * 为什么不复用 daemon 的 MCP：agent CLI 要求**一个独立的 stdio 子进程**，
 * 而画布的单会话 WebSocket 归 daemon 所有。所以本进程只做协议翻译。
 *
 * ⚠ stdout 归 MCP 协议所有，日志一律写 stderr。
 *
 * 用法（Claude Code 示例）：
 *   claude -p "..." --mcp-config '{"mathmover":{"command":"node","args":["packages/daemon/src/mcp-stdio.ts"]}}'
 */

import { createMcpServer } from './mcp-server.ts';
import { serveStdio } from './mcp-server.ts';
import { createHttpBackedTools } from './tools-http.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAEMON_URL = process.env.MATHMOVER_DAEMON_URL ?? 'http://127.0.0.1:8788';

/**
 * skill 资产根目录 —— 从**本文件自身位置**推，不靠 cwd。
 *
 * cwd 是 agent 的沙箱工作区（每窗口一份、落在数据目录下），那里只有工作稿，
 * **没有 ggb_commands.json / skills/**。靠 cwd 猜会让 ggb_apply 等
 * 要读白名单的工具直接 ENOENT（实测：工作稿读写好好的，校验连报两次错）。
 * 资产跟安装目录走，工作稿跟沙箱走——两件事。
 */
function findAssetRoot(): string {
  const env = process.env.MATHMOVER_ROOT;
  if (env) return env;
  // 本文件在 <root>/packages/daemon/src/，上溯三层即仓库根
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

function log(...a: unknown[]): void {
  console.error('[mathmover-mcp]', ...a);
}

async function main(): Promise<void> {
  const tools = createHttpBackedTools(DAEMON_URL);
  log(`指向 daemon: ${DAEMON_URL}`);
  log('MCP stdio 就绪，等待 agent 连接…');

  // createMcpServer 内部会注册 ggb_get_state / ggb_apply（含行级与动点自洽自查）/ ggb_reset，
  // 以及知识供给三件套。工作稿的读写不再是 MCP 工具——agent 自带 Read/Edit
  //（2026-10-18：那对兜底工具随自研 BYOK 循环一起删了）。
  await serveStdio(tools as never, { name: 'mathmover', version: '0.1.0' }, {
    rootDir: findAssetRoot(),
  });
}

main().catch((e) => {
  log('启动失败:', e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});

// createMcpServer 仅供类型提示，避免未使用告警
void createMcpServer;
