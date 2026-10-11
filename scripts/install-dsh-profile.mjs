/**
 * 一键装 MathMover 的 dsh profile（新机器上跑一次即可）。
 *
 * 为什么需要这一步：dsh 的 JSONL 协议不是 dsh 核心能力，而是靠一个 **profile bundle**
 * 提供（`--models` / `--probe` / `--stdio` 三个命令都是它注册的）。我们的 bundle 在
 * packages/dsh-runtime，得装进 ~/.dsh/profiles/mathmover/ 才被 dsh 认得。
 *
 * 做四件事：
 *   1. 建 profile 目录（package.json / cordis.yml / cordis.patch.yml / pnpm-workspace.yaml）
 *   2. 构建 bundle
 *   3. npm pack 出 tarball
 *   4. dsh plugin --profile mathmover add <tarball>（就是 pnpm 装包）
 *
 * 跑法：node scripts/install-dsh-profile.mjs
 * 幂等：重跑会覆盖 profile 的配置文件并重装 bundle。
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUNDLE_DIR = path.join(REPO, 'packages', 'dsh-runtime');
const DSH_HOME = process.env.DSH_HOME
  ? path.resolve(process.env.DSH_HOME)
  : path.join(os.homedir(), '.dsh');
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', 'mathmover');

function quote(arg) {
  // 显式引号包裹后再交给 shell —— execFileSync 的 shell:true 是「参数不转义只拼接」，
  // Node 已就此弃用并告警（DEP0190）。这里所有参数都自己拼，杜绝注入面。
  if (process.platform === 'win32') return `"${String(arg).replace(/"/g, '""')}"`;
  return `'${String(arg).replace(/'/g, `'\\''`)}'`;
}

function run(cmd, args = [], opts = {}) {
  const { shell, timeout, ...rest } = opts;
  if (shell) {
    // 命令名不加引号——Windows 的 .cmd shim（npm/dsh）被引号包住就解析不到入口；
    // 只引用参数，参数才是可能带空格/特殊字符的那部分。
    return execSync([cmd, ...args.map(quote)].join(' '), { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'], timeout, ...rest });
  }
  return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'], timeout, ...rest });
}

function findDsh() {
  // npm 装的 dsh 是 .cmd shim；execFileSync 走 shell 时 Windows 上才认，
  // 这里统一交给 shell，避免各自平台的 shim 解析差异。
  try { return run(process.platform === 'win32' ? 'where' : 'which', ['dsh']).trim().split('\n')[0]; }
  catch { throw new Error('找不到 dsh。请先装 DeepSeek Harness（npm i -g @deepseek-ai/dsh）。'); }
}

function writeFileIfDifferent(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf-8') === content) return false;
  fs.writeFileSync(file, content, 'utf-8');
  return true;
}

console.log(`MathMover dsh profile 安装\n  DSH_HOME=${DSH_HOME}\n  profile=${PROFILE_DIR}\n`);

// 1) profile 脚手架
fs.mkdirSync(path.join(PROFILE_DIR, '.mathmover'), { recursive: true });

const pkg = `${JSON.stringify({
  name: 'dsh-profile-mathmover',
  private: true,
  dependencies: {},
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@mathmover/dsh-runtime'] } },
}, null, 2)}\n`;

// autoInstallPeers: false 是**必须**的：dsh 的包在 npm 上的 latest 是旧 rc，
// 让 pnpm 去装 peer 会拉到不兼容的旧版（实测踩过：dsh-attachment 0.0.1-rc.1
// 没有 admitEncodedImages）。不开它，peer 就从 dsh 自己的共享库解析。
const workspace = `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n`;

// dsh profile 的 cordis 根：空列表，组合全靠 bundle 与 patch 层
const cordis = '# dsh profile root — composed as patches.\n[]\n';

// 用户覆盖层留空：模型/凭证/工具都归用户自己的 dsh 安装管，我们不碰。
const patch = '# MathMover profile 的用户覆盖层。\n# 模型、凭证、工具、会话都归你的 dsh 安装管，这里一般不用写东西。\n[]\n';

const written = [
  writeFileIfDifferent(path.join(PROFILE_DIR, 'package.json'), pkg),
  writeFileIfDifferent(path.join(PROFILE_DIR, 'pnpm-workspace.yaml'), workspace),
  writeFileIfDifferent(path.join(PROFILE_DIR, 'cordis.yml'), cordis),
  writeFileIfDifferent(path.join(PROFILE_DIR, 'cordis.patch.yml'), patch),
].filter(Boolean).length;
console.log(`1) profile 脚手架：${written} 个文件写入/更新`);

// 2) 构建 bundle
console.log('2) 构建 bundle …');
run(process.execPath, ['build.mjs'], { cwd: BUNDLE_DIR, stdio: ['ignore', 'inherit', 'inherit'] });

// 3) 打包
console.log('3) npm pack …');
const packOut = run('npm', ['pack', '--silent'], { cwd: BUNDLE_DIR, shell: true });
const tarball = packOut.trim().split('\n').pop().trim();
const tarballPath = path.join(BUNDLE_DIR, tarball);
if (!fs.existsSync(tarballPath)) throw new Error(`npm pack 没产出 ${tarballPath}`);

// 4) 装进 profile。用**相对路径**传给 pnpm —— 绝对路径在 Windows 上会被
//    shell 转发按空格切断（OpenDesign 踩过：路径里有 "OpenDesign" 这种带空格的目录名）。
fs.copyFileSync(tarballPath, path.join(PROFILE_DIR, '.mathmover', tarball));
console.log(`4) dsh plugin add ${tarball} …`);
const dsh = findDsh();
run(dsh, ['plugin', '--profile', 'mathmover', 'add', `.mathmover/${tarball}`], {
  cwd: PROFILE_DIR, stdio: ['ignore', 'inherit', 'inherit'], shell: true,
});

// 5) 自检：协议三命令能不能起来
console.log('5) 自检 …');
const probe = run(dsh, ['--profile', 'mathmover', '--probe'], { shell: true, timeout: 60_000 });
const frame = JSON.parse(probe.trim().split('\n').pop());
if (frame.type !== 'probe' || frame.runtime !== 'mathmover') {
  throw new Error(`自检失败：--probe 返回了 ${probe.trim()}`);
}
console.log(`   ✓ --probe 正常（runtime=${frame.runtime}，协议 v${frame.protocol_version}，插件 ${frame.plugin_version}）`);

const models = run(dsh, ['--profile', 'mathmover', '--models'], { shell: true, timeout: 60_000 });
const catalog = JSON.parse(models.trim().split('\n').pop());
console.log(`   ✓ --models 正常（${catalog.models?.length ?? 0} 个模型）`);

console.log('\n安装完成。dsh 运行时现在支持模型选择与原生会话。');
