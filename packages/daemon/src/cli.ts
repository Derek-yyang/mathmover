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
import { GGB_ERROR } from '@mathmover/ggb-core';
import { serveStdio } from './mcp-server.ts';
import { listenHttp } from './http-api.ts';
import { CoursewareStore } from './courseware-store.ts';
import { dataDirectory, libraryToken } from './data-directory.ts';
import { removeLegacyWindowRoot, sweepWorkspaces, workspaceDir } from './workspaces.ts';

const VERSION = '0.1.0';

function log(...args: unknown[]): void {
  console.error('[mathmover-daemon]', ...args);
}

function parseArgs(argv: string[]) {
  const out = {
    wsPort: Number(process.env.MATHMOVER_WS_PORT ?? 8787),
    httpPort: Number(process.env.MATHMOVER_HTTP_PORT ?? 8788),
    workdir: process.env.MATHMOVER_WORKDIR ?? process.cwd(),
    dataDir: dataDirectory(),
    includePng: process.env.MATHMOVER_NO_PNG !== '1',
    transport: 'stdio' as 'stdio' | 'none',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ws-port') out.wsPort = Number(argv[++i]);
    else if (a === '--http-port') out.httpPort = Number(argv[++i]);
    else if (a === '--workdir') out.workdir = path.resolve(argv[++i]);
    else if (a === '--data-dir') out.dataDir = path.resolve(argv[++i]);
    else if (a === '--no-png') out.includePng = false;
    else if (a === '--no-mcp') out.transport = 'none';
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'mathmover-daemon —— MathMover 本地守护进程\n\n' +
        '用法: mathmover-daemon [选项]\n\n' +
        '  --ws-port <n>     WebSocket 端口（默认 8787，只绑 127.0.0.1）\n' +
        '  --workdir <dir>   受管工作目录，construction.ggb.txt 写这里（默认 cwd）\n' +
        '  --data-dir <dir>  用户课件库目录（默认用户 AppData，Next 需同设 MATHMOVER_DATA_DIR）\n' +
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
    log(up ? '画布已连接' : `画布已断开（工具调用会报 ${GGB_ERROR.SESSION_DEAD}）`);
  });

  await bridge.start();
  log(`WebSocket 桥已监听 ws://127.0.0.1:${args.wsPort}（仅回环）`);

  log(`受管工作目录: ${cfg.workdir}`);

  const store = new CoursewareStore(args.dataDir);
  const token = libraryToken(store.root, true);

  // 启动扫描：清掉不属于任何在世课件的孤儿工作区（详见 workspaces.ts）。
  // 此刻按定义没有窗口连着，所以 workspaces/ 下的一切都是上次跑剩的。
  // live 必须含**归档**课件——归档不是删除，它还活着。
  const live = [...store.list(), ...store.list(true)].map((r) => r.id);
  const swept = sweepWorkspaces(store.root, live);
  if (swept.length) log(`清理孤儿工作区 ${swept.length} 个`);
  if (removeLegacyWindowRoot(store.root)) log('清理旧布局 windows/（工作稿已改落 workspaces/）');

  // 构造工作稿（含无课件 id 的兜底）一律落**数据目录**下的工作区：
  // 用户数据归数据目录、软件归软件。--workdir 只是 agent 的项目参考，
  // 不再是工作稿的落点。
  const tools = new GgbTools(bridge, { ...cfg, workdir: workspaceDir(store.root) });

  await listenHttp(tools, { port: args.httpPort, host: '127.0.0.1', library: { store, token, bridge },
    // 两个键各管一件事：id（窗口）找画布连接，coursewareId 定工作稿目录。
    // 只带 coursewareId 的调用（如前端同步草稿）拿默认 bridge——那几个操作纯文件 I/O，不碰画布。
    toolsForWindow: (id, coursewareId) => new GgbTools(id ? bridge.forWindow(id) : bridge,
      { ...cfg, workdir: workspaceDir(store.root, coursewareId) }) });
  log(`本地课件库: ${store.root}（与安装目录分离）`);
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
