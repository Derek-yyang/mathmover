/**
 * 桌面打包的资产准备 —— 把「三个进程要用的东西」收进 desktop/build/。
 *
 * 产出布局（与 src/main.cjs 的 BUILD_ROOT 对应）：
 *   build/next/    Next standalone（server.js + .next-desktop/static + public）
 *   build/app/     MATHMOVER_ROOT：ggb_commands.json、skills/、daemon 预编译入口、
 *                  packages/daemon/mcp/dsh-mathmover.patch.yml
 *   build/node/    随包分发的 Node 24（daemon 依赖 node:sqlite，Electron 自带的 Node 不保证有）
 *   build/bin/     自带的 opencode 二进制（只放与当前平台匹配的一份，baseline 靠后）
 *
 * 为什么 daemon 要预编译：安装目录里的 .ts 不能被 asar 外的 node 直接执行；
 * esbuild 打成单文件 JS 后，mcp-stdio 仍按 `packages/daemon/src/mcp-stdio.ts`
 * 的**路径形状**落盘（内容是 JS，Node 24 的类型剥离对纯 JS 是空操作），
 * 这样 ensureMcpConfig 生成的配置不用改一行代码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import platform from '../src/platform.cjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '..');
const appDir = path.join(repo, 'math-mover-next');
const build = path.join(desktop, 'build');
const DIST = '.next-desktop';
const IS_WIN = process.platform === 'win32';
// 迭代 daemon/壳时跳过 Next 重建：MATHMOVER_SKIP_NEXT=1
const SKIP_NEXT = process.env.MATHMOVER_SKIP_NEXT === '1';

const log = (...a) => console.log('[prepare]', ...a);
const die = (msg) => { console.error('[prepare] 失败：' + msg); process.exit(1); };

if (Number(process.versions.node.split('.')[0]) < 24) {
  die(`打包脚本必须用 Node 24+ 运行（当前 ${process.versions.node}）——daemon 依赖 node:sqlite`);
}

if (SKIP_NEXT) {
  for (const dir of ['app', 'node', 'bin']) fs.rmSync(path.join(build, dir), { recursive: true, force: true });
} else {
  fs.rmSync(build, { recursive: true, force: true });
}
fs.mkdirSync(build, { recursive: true });

// ── 1. Next 生产构建 ──────────────────────────────────────────────
if (!SKIP_NEXT) {
log('构建 Next（standalone）…');
const tsconfig = path.join(appDir, 'tsconfig.json');
const tsconfigBefore = fs.readFileSync(tsconfig, 'utf8');
const nextBin = path.join(appDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const built = spawnSync(process.execPath, [nextBin, 'build'], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, MATHMOVER_NEXT_DIST_DIR: DIST, NEXT_TELEMETRY_DISABLED: '1', MATHMOVER_DESKTOP: '1' },
});
// Next 会往 tsconfig.include 里写本轮的 distDir 类型目录；构建完恢复，别污染工作区
if (fs.readFileSync(tsconfig, 'utf8') !== tsconfigBefore) fs.writeFileSync(tsconfig, tsconfigBefore);
if (built.status !== 0) die('next build 失败');

const standaloneRoot = path.join(appDir, DIST, 'standalone');
function findServer(dir, depth = 0) {
  if (depth > 3) return null;
  const direct = path.join(dir, 'server.js');
  if (fs.existsSync(direct)) return dir;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const hit = findServer(path.join(dir, ent.name), depth + 1);
    if (hit) return hit;
  }
  return null;
}
const serverDir = findServer(standaloneRoot);
if (!serverDir) die(`standalone 里找不到 server.js（${standaloneRoot}）`);

const nextDest = path.join(build, 'next');
fs.cpSync(serverDir, nextDest, { recursive: true });
fs.cpSync(path.join(appDir, DIST, 'static'), path.join(nextDest, DIST, 'static'), { recursive: true });
fs.cpSync(path.join(appDir, 'public'), path.join(nextDest, 'public'), { recursive: true });
log(`Next 就绪：${path.relative(desktop, nextDest)}`);
}
const nextDest = path.join(build, 'next');
if (!fs.existsSync(path.join(nextDest, 'server.js'))) die('build/next 里没有 server.js（跳过 Next 构建时需先成功构建过一次）');

// ── 2. daemon 预编译 ──────────────────────────────────────────────
log('预编译 daemon…');
const requireFromRoot = createRequire(path.join(repo, 'package.json'));
const esbuild = requireFromRoot('esbuild');

const daemonSrc = path.join(repo, 'packages', 'daemon', 'src');
const daemonDest = path.join(build, 'app', 'packages', 'daemon', 'src');
fs.mkdirSync(daemonDest, { recursive: true });

async function bundle(entry, outfile) {
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // node:sqlite 走 createRequire 的运行时字符串，打包器不该替它做任何事
    external: ['node:sqlite'],
    // 打包进来的 CJS 依赖（ws / MCP SDK 等）会动态 require 内置模块；
    // ESM 产物里没有 require，esbuild 的兜底会直接抛 "Dynamic require ... not supported"
    banner: { js: "import { createRequire as __mmRequire } from 'node:module'; const require = __mmRequire(import.meta.url);" },
    logLevel: 'warning',
  });
}
await bundle(path.join(daemonSrc, 'cli.ts'), path.join(daemonDest, 'cli.mjs'));
// 注意扩展名：ensureMcpConfig 会按 <root>/packages/daemon/src/mcp-stdio.ts 生成 spawn arg
await bundle(path.join(daemonSrc, 'mcp-stdio.ts'), path.join(daemonDest, 'mcp-stdio.ts'));
// 让 Node 明确按 ESM 解析 .ts（否则会先按 CJS 试脱、再靠语法检测重解析并打警告）
fs.writeFileSync(
  path.join(build, 'app', 'packages', 'daemon', 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n',
);

// daemon 运行时要读的资产：命令白名单/目录、技能包、dsh 的 patch（与 MCP 配置同目录）
const assetRoot = path.join(build, 'app');
fs.copyFileSync(path.join(repo, 'ggb_commands.json'), path.join(assetRoot, 'ggb_commands.json'));
fs.cpSync(path.join(repo, 'skills'), path.join(assetRoot, 'skills'), { recursive: true });
const mcpDir = path.join(assetRoot, 'packages', 'daemon', 'mcp');
fs.mkdirSync(mcpDir, { recursive: true });
const dshPatch = path.join(repo, 'packages', 'daemon', 'mcp', 'dsh-mathmover.patch.yml');
if (fs.existsSync(dshPatch)) fs.copyFileSync(dshPatch, path.join(mcpDir, 'dsh-mathmover.patch.yml'));
log('daemon 与资产就绪');

// ── 3. 随包 Node ─────────────────────────────────────────────────
log(`随包 Node：${process.versions.node}`);
const nodeDest = path.join(build, 'node', IS_WIN ? 'node.exe' : 'node');
fs.mkdirSync(path.dirname(nodeDest), { recursive: true });
fs.copyFileSync(process.execPath, nodeDest);
if (!IS_WIN) fs.chmodSync(nodeDest, 0o755);

// ── 4. 自带 opencode（按平台挑一份，baseline 靠后）────────────────
const modules = path.join(appDir, 'node_modules');
const opencodePkgs = platform.opencodePackages(fs.readdirSync(modules), process.platform, process.arch);
const opencodeSrc = opencodePkgs
  .map((n) => path.join(modules, n, 'bin', IS_WIN ? 'opencode.exe' : 'opencode'))
  .find((p) => fs.existsSync(p));
if (!opencodeSrc) die(`找不到与 ${process.platform}/${process.arch} 匹配的 opencode 平台包`);
const opencodeDest = path.join(build, 'bin', IS_WIN ? 'opencode.exe' : 'opencode');
fs.mkdirSync(path.dirname(opencodeDest), { recursive: true });
fs.copyFileSync(opencodeSrc, opencodeDest);
if (!IS_WIN) fs.chmodSync(opencodeDest, 0o755);
log(`opencode：${path.relative(modules, opencodeSrc)}`);

// 在产出安装包之前执行真实二进制，及时发现错架构、丢失权限等问题。
for (const executable of [nodeDest, opencodeDest]) {
  const probe = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  if (probe.error || probe.status !== 0) die(`${executable} 无法运行：${probe.error?.message || probe.stderr}`);
  log(`${path.basename(executable)} 验证通过：${probe.stdout.trim()}`);
}

// ── 5. 汇报 ─────────────────────────────────────────────────────
const size = (p) => {
  let total = 0;
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, ent.name);
      if (ent.isDirectory()) walk(f);
      else total += fs.statSync(f).size;
    }
  };
  if (fs.statSync(p).isDirectory()) walk(p); else total = fs.statSync(p).size;
  return (total / 1024 / 1024).toFixed(1) + ' MB';
};
log(`完成：next=${size(nextDest)} app=${size(assetRoot)} node=${size(nodeDest)} opencode=${size(opencodeDest)}`);
