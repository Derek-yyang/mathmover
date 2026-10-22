import fs from 'node:fs';
import path from 'node:path';
import { dataDirectory } from '../../../packages/daemon/src/data-directory.ts';

/** 课件 id 的取值域——与 daemon 侧 `workspaces.ts` 同一把尺子。 */
const ID = /^[a-zA-Z0-9_-]{1,100}$/;

/**
 * agent 的沙箱工作区 —— 每**课件**一份。
 *
 * agent 用 `--restricted` 起（要它禁掉 Bash/代码执行），而 restricted 把文件
 * 写入也框死在 cwd 里。所以**沙箱必须落在数据目录下**——用户数据归数据目录、
 * 软件归软件，别混（实测把工作稿放进仓库目录能让 agent 写，但那是在拿架构债换解 bug）。
 *
 * 键是**课件 id**（一份动图 ↔ 一份指令清单 ↔ 一个工作稿，互不串）。早期按窗口 id
 * 命名，而窗口 id 是页面挂载时现生成的随机 UUID——于是每次启动应用就多一个没人清的
 * 目录。草稿本身可再生（载入课件会重灌、apply 后按画布回写），回收逻辑在 daemon 侧
 * 的 `packages/daemon/src/workspaces.ts`。
 *
 * 课件 id 缺失或不合法时落 `_default`——与 daemon 同一套兜底，不引入第二套命名规则。
 */
export function workspaceDir(coursewareId: string | undefined): string {
  const id = typeof coursewareId === 'string' ? coursewareId.trim() : '';
  return path.join(dataDirectory(), 'workspaces', ID.test(id) ? id : '_default');
}

/** 沙箱里的工作稿绝对路径——agent 的 cwd 就是沙箱，故文件名即可，但报绝对路径更省事。 */
export function constructionPath(coursewareId: string | undefined): string {
  return path.join(workspaceDir(coursewareId), 'construction.ggb.txt');
}

/**
 * 预建**空**工作稿（已有草稿绝不覆盖），返回它的绝对路径。
 *
 * agent 的第一反应是「先读再改」，而新课件根本没有这份文件——实测它第一轮先吃一个
 * Read 失败、用户那边多一条"工具返回错误"，白烧一次往返。空文件让「读 → 追加 → apply」
 * 这条链路从第一轮就成立。
 *
 * daemon 侧读缺文件本来就不报错（按空处理），所以这里要解决的只是 **agent 的原生 Read**。
 */
export function ensureConstructionDraft(coursewareId: string | undefined): string {
  const file = constructionPath(coursewareId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  return file;
}

let cachedMcpConfig: string | null = null;

/**
 * 生成带**绝对路径**的 MCP 配置。
 *
 * 三家 CLI 都把 `args` 按相对路径解析（claude 的 --mcp-config、codex 的
 * `mcp_servers.*.args`、dsh 的 patch 都吃这份 JSON）。agent 的 cwd 要改成沙箱，
 * 相对路径就断了——所以运行时把绝对路径写进配置。
 *
 * 默认写在 `packages/daemon/mcp/` 下：dsh 用 `dirname(mcpConfigPath)` 找
 * `dsh-mathmover.patch.yml`，同目录才找得到。
 *
 * 桌面安装版可能被装到只读目录（用户自选 Program Files 等），所以允许
 * `MATHMOVER_MCP_DIR` 把配置目录指到可写的数据目录；dsh 的 patch 一并复制过去。
 */
export function ensureMcpConfig(repoRoot: string, daemonUrl: string): string {
  if (cachedMcpConfig) return cachedMcpConfig;
  const assetDir = path.join(repoRoot, 'packages', 'daemon', 'mcp');
  const override = process.env.MATHMOVER_MCP_DIR?.trim();
  const dir = override ? path.resolve(override) : assetDir;
  const file = path.join(dir, 'runtime-mcp.json');
  fs.mkdirSync(dir, { recursive: true });
  if (dir !== assetDir) {
    // 升级后 patch 可能变化；每次都从当前安装目录覆盖到可写目录。
    const source = path.join(assetDir, 'dsh-mathmover.patch.yml');
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(dir, 'dsh-mathmover.patch.yml'));
  }
  const cfg = {
    mcpServers: {
      mathmover: {
        // 用正在运行 daemon 的那个 node 的绝对路径，不靠 PATH——
        // 别人机器上 node 不在 PATH（nvm 切版本、装在非标准位置）就会起不来。
        command: process.execPath,
        args: [path.join(repoRoot, 'packages', 'daemon', 'src', 'mcp-stdio.ts')],
        env: { MATHMOVER_DAEMON_URL: daemonUrl },
      },
    },
  };
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf-8');
  cachedMcpConfig = file;
  return file;
}

/** 测试用：清掉 MCP 配置记忆化。 */
export function resetMcpConfigCache(): void {
  cachedMcpConfig = null;
}
