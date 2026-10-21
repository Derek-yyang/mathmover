/**
 * 自动更新闭环验证：装旧版 → 本地更新源 → 应用自己下载并静默升级 → 读回版本号。
 *
 * 用法（先按 README「本地验证自动更新」准备好两个版本）：
 *   node desktop/scripts/verify-update.mjs \
 *     --old desktop/release/update-old \
 *     --feed desktop/release/update-new \
 *     --expected 0.1.1
 *
 * 说明：
 * - 更新源是一个本地 HTTP 服务，**支持 Range**（差分下载需要）；
 * - 旧版安装到 `%LOCALAPPDATA%\Programs\mathmover-desktop`（one-click 的默认位置）；
 * - 启动旧版时把 `LOCALAPPDATA` 指到临时目录，避免污染真实用户数据；
 * - 结束会卸掉测试版本。
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const oldDir = path.resolve(arg('old', 'desktop/release/update-old'));
const feedDir = path.resolve(arg('feed', 'desktop/release/update-new'));
const expected = arg('expected', '');
const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'mathmover-desktop');
const exe = path.join(installDir, 'MathMover.exe');
const uninstaller = path.join(installDir, 'Uninstall MathMover.exe');
const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-update-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[verify-update]', ...a);

function killTree(name) {
  spawnSync('taskkill', ['/IM', name, '/T', '/F'], { windowsHide: true });
}
function killPid(pid) {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
}

function fileVersion() {
  if (!fs.existsSync(exe)) return '';
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item '${exe}' -ErrorAction Stop).VersionInfo.FileVersion`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return ''; }
}

/** 杀掉安装目录里的所有进程（应用 + 随包 node），否则卸载会被占用。 */
function killInstallDir() {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*mathmover-desktop*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ], { stdio: 'ignore' });
  } catch { /* 没有匹配的进程 */ }
}

function waitFor(predicate, timeoutMs, intervalMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

// ── 本地更新源（支持 Range）──────────────────────────────────────
const served = [];
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\//, ''));
  const file = path.join(feedDir, name);
  if (!file.startsWith(feedDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const size = fs.statSync(file).size;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, {
      'content-type': 'application/octet-stream',
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'content-length': end - start + 1,
    });
    served.push({ name, bytes: end - start + 1, range: true });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', 'content-length': size });
  served.push({ name, bytes: size, range: false });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const feedUrl = `http://127.0.0.1:${server.address().port}`;
log('更新源：', feedUrl, '→', feedDir);

try {
  // ── 安装旧版 ───────────────────────────────────────────────────
  const oldInstaller = fs.existsSync(oldDir) && fs.readdirSync(oldDir).find((n) => n.endsWith('.exe'));
  if (!oldInstaller) throw new Error(`旧版安装包不在 ${oldDir}`);
  killTree('MathMover.exe');
  log('安装旧版：', oldInstaller);
  spawnSync(path.join(oldDir, oldInstaller), ['/S'], { windowsHide: true, stdio: 'ignore' });
  if (!(await waitFor(() => fs.existsSync(exe), 60_000))) throw new Error('旧版没有安装成功');
  log('旧版版本：', fileVersion());

  // ── 启动旧版，让它自己更新 ─────────────────────────────────────
  const env = {
    ...process.env,
    LOCALAPPDATA: tempData,
    MATHMOVER_UPDATE_URL: feedUrl,
    MATHMOVER_UPDATE_AUTOINSTALL: '1',
    ELECTRON_ENABLE_LOGGING: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(exe, [], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const appLog = [];
  app.stdout.on('data', (c) => appLog.push(String(c)));
  app.stderr.on('data', (c) => appLog.push(String(c)));

  log('启动旧版（15 秒后检查更新）…');
  const upgraded = await waitFor(() => expected && fileVersion() === expected, 6 * 60_000, 2000);
  if (!upgraded) {
    console.log(appLog.join('').slice(-3000));
    throw new Error(`没有升级到 ${expected}（当前 ${fileVersion()}）`);
  }
  log('已升级到：', fileVersion());

  const total = served.reduce((n, s) => n + s.bytes, 0);
  const ranged = served.filter((s) => s.range).length;
  log(`更新源共送出 ${(total / 1024 / 1024).toFixed(1)} MB（${served.length} 个请求，其中 ${ranged} 个 Range）`);
  console.log(`PASS: 自动更新 ${fileVersion()} 成功`);
} finally {
  killInstallDir();
  await sleep(1000);
  server.close();
  // ── 卸载测试版本 ───────────────────────────────────────────────
  try {
    if (fs.existsSync(uninstaller)) spawnSync(uninstaller, ['/S'], { windowsHide: true, stdio: 'ignore' });
    const gone = await waitFor(() => !fs.existsSync(installDir), 30_000, 1000);
    if (!gone) {
      killTree('Un_A.exe'); killTree('UnInstDaemon.exe');
      killInstallDir();
      await sleep(1000);
      fs.rmSync(installDir, { recursive: true, force: true });
    }
    log('测试版本已卸载');
  } catch (e) {
    log('卸载失败（可手动删除）：', installDir, e instanceof Error ? e.message : e);
  }
  try { fs.rmSync(tempData, { recursive: true, force: true }); } catch { /* 忽略 */ }
}
