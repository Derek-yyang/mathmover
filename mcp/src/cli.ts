#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { createRuntime } from './runtime.ts';
import {
  defaultDataDirectory,
  ensurePersistentService,
  runPersistentDaemon,
  shutdownPersistentService,
} from './service.ts';
import { setupWorkBuddy } from './workbuddy-setup.ts';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('MathMover MCP 版\n用法：mathmover-mcp [--data-dir <目录>]\n--print-config 输出本机 MCP 配置\nsetup-workbuddy 自动写入 WorkBuddy MCP 配置\n--shutdown-daemon 停止本地画板服务\n由宿主 Agent 启动 stdio MCP，画板地址通过 mathmover_open_canvas 返回。');
    return;
  }
  if (args.length === 1 && args[0] === '--print-config') {
    console.log(JSON.stringify({ mcpServers: { mathmover: { command: process.execPath, args: [__filename] } } }, null, 2));
    return;
  }
  let dataDir = process.env.MATHMOVER_MCP_DATA_DIR ?? defaultDataDirectory();
  if (args[0] === 'setup-workbuddy' || args[0] === '--setup-workbuddy') {
    let configDir: string | undefined;
    let dryRun = false;
    for (let index = 1; index < args.length; index++) {
      if (args[index] === '--config-dir' && args[index + 1]) {
        configDir = args[++index];
        continue;
      }
      if (args[index] === '--dry-run') {
        dryRun = true;
        continue;
      }
      throw new Error('参数无效，帮助请用 --help');
    }
    const result = await setupWorkBuddy({
      configDir,
      nodePath: process.execPath,
      cliPath: __filename,
      dataDir: path.resolve(dataDir),
      dryRun,
    });
    if (result.dryRun) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(result.changed ? `已写入 WorkBuddy MCP 配置：${result.configPath}` : `WorkBuddy MCP 配置已是当前版本：${result.configPath}`);
    if (result.backupPath) console.log(`原配置已备份：${result.backupPath}`);
    console.log('请完全退出并重新打开 WorkBuddy，然后新建任务。');
    return;
  }
  let daemon = false;
  let shutdownDaemon = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--daemon') {
      daemon = true;
      continue;
    }
    if (args[index] === '--shutdown-daemon') {
      shutdownDaemon = true;
      continue;
    }
    if (args[index] === '--data-dir' && args[index + 1]) {
      dataDir = args[++index];
      continue;
    }
    throw new Error('参数无效，帮助请用 --help');
  }
  if (daemon && shutdownDaemon) throw new Error('--daemon 与 --shutdown-daemon 不能同时使用');
  if (daemon) {
    await runPersistentDaemon({ dataDir, distDir: __dirname });
    return;
  }
  if (shutdownDaemon) {
    const stopped = await shutdownPersistentService(dataDir);
    console.log(stopped ? 'MathMover 本地画板服务已停止' : 'MathMover 本地画板服务未运行');
    return;
  }
  const service = await ensurePersistentService({ dataDir, distDir: __dirname, entryPoint: __filename });
  const runtime = await createRuntime({ dataDir, distDir: __dirname, service });
  const shutdown = () => { void runtime.close().catch(error => console.error('[mathmover-mcp]', error)); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.stdin.once('end', shutdown);
  runtime.server.onclose = shutdown;
  await runtime.server.connect(new StdioServerTransport());
  console.error(`[mathmover-mcp] 画板服务 ${service.origin} 已就绪，画板会在 MCP 任务结束后继续运行`);
}

main().catch(error => {
  console.error('[mathmover-mcp]', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
