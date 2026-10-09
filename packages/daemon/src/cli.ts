#!/usr/bin/env node
/**
 * MathMover daemon 入口。
 *
 * 形态对齐 OpenDesign 的「本地守护进程」：
 *   - WebSocket 服务端监听 127.0.0.1（网页侧连过来）
 *   - MCP server 走 stdio，agent 通过它调用工具
 *   - 受管工作目录里写 construction.ggb.txt，agent 可用原生读文件看到画布
 *
 * ⚠ MCP stdio 模式下 **stdout 归协议所有**，一切日志必须写 stderr。
 */

import path from 'node:path';
import { GgbBridgeClient } from './bridge-client.ts';
import { GgbTools, DEFAULT_TOOLS_CONFIG, type ToolsConfig } from './tools.ts';
import { serveStdio } from './mcp-server.ts';
import { listenHttp } from './http-api.ts';

const VERSION = '0.1.0';

function log(...args: unknown[]): void {
  console.error('[mathmover-daemon]', ...args);
}

function parseArgs(argv: string[]) {
  const out = {
    wsPort: Number(process.env.MATHMOVER_WS_PORT ?? 8787),
    httpPort: Number(process.env.MATHMOVER_HTTP_PORT ?? 8788),
    workdir: process.env.MATHMOVER_WORKDIR ?? process.cwd(),
    includePng: process.env.MATHMOVER_NO_PNG !== '1',
    transport: 'stdio' as 'stdio' | 'none',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ws-port') out.wsPort = Number(argv[++i]);
    else if (a === '--http-port') out.httpPort = Number(argv[++i]);
    else if (a === '--workdir') out.workdir = path.resolve(argv[++i]);
    else if (a === '--no-png') out.includePng = false;
    else if (a === '--no-mcp') out.transport = 'none';
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'mathmover-daemon —— MathMover 本地守护进程\n\n' +
        '用法: mathmover-daemon [选项]\n\n' +
        '  --ws-port <n>     WebSocket 端口（默认 8787，只绑 127.0.0.1）\n' +
        '  --workdir <dir>   受管工作目录，construction.ggb.txt 写这里（默认 cwd）\n' +
        '  --no-png          不在工具返回里附带画布截图\n' +
        '  --no-mcp          不启动 MCP stdio（只跑 WebSocket 桥，便于调试）\n' +
        '  -h, --help        显示本帮助\n\n' +
        'agent 侧接入（以 Claude Code 为例）:\n' +
        '  claude mcp add mathmover -- node /path/to/packages/daemon/src/cli.ts --workdir /path/to/project\n',
      );
      process.exit(0);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg: ToolsConfig = {
    ...DEFAULT_TOOLS_CONFIG,
    workdir: args.workdir,
    includePng: args.includePng,
  };

  const bridge = new GgbBridgeClient({ port: args.wsPort, host: '127.0.0.1' });
  bridge.onConnectionChange((up) => {
    log(up ? '画布已连接' : '画布已断开（工具调用会报 GGB_SESSION_DEAD）');
  });

  await bridge.start();
  log(`WebSocket 桥已监听 ws://127.0.0.1:${args.wsPort}（仅回环）`);

  log(`受管工作目录: ${cfg.workdir}`);

  const tools = new GgbTools(bridge, cfg);

  await listenHttp(tools, { port: args.httpPort, host: '127.0.0.1' });
  log(`HTTP 工具面已监听 http://127.0.0.1:${args.httpPort}（/api/health|state|apply|diff|reset）`);

  if (args.transport === 'stdio') {
    log('MCP stdio 已就绪，等待 agent 连接…');
    await serveStdio(tools, { name: 'mathmover', version: VERSION });
  } else {
    log('已跳过 MCP（--no-mcp）');
    // 无 MCP 时保持进程存活，便于只测 WebSocket 桥
    await new Promise(() => {});
  }
}

const shutdown = async (code = 0) => {
  log('正在关闭…');
  process.exit(code);
};

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

main().catch((e) => {
  log('启动失败:', e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
