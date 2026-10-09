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

const DAEMON_URL = process.env.MATHMOVER_DAEMON_URL ?? 'http://127.0.0.1:8788';

function log(...a: unknown[]): void {
  console.error('[mathmover-mcp]', ...a);
}

async function main(): Promise<void> {
  const tools = createHttpBackedTools(DAEMON_URL);
  log(`指向 daemon: ${DAEMON_URL}`);
  log('MCP stdio 就绪，等待 agent 连接…');

  // createMcpServer 内部会注册 ggb_get_state / ggb_apply / ggb_diff / ggb_reset
  await serveStdio(tools as never, { name: 'mathmover', version: '0.1.0' });
}

main().catch((e) => {
  log('启动失败:', e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});

// createMcpServer 仅供类型提示，避免未使用告警
void createMcpServer;
