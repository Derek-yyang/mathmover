import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(join(root, 'geogebra-runtime.json'), 'utf8'));
const target = join(root, 'public', 'vendor', 'geogebra', config.version);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function inventory(directory, prefix = '') {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'installed.json') continue;
    const path = join(directory, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, await inventory(path, name + '/'));
    else files[name] = digest(await readFile(path));
  }
  return files;
}

async function verify() {
  const manifest = JSON.parse(await readFile(join(target, 'installed.json'), 'utf8'));
  if (manifest.sha256 !== config.sha256 || manifest.version !== config.version) {
    throw new Error('GeoGebra 版本或安装记录不匹配。');
  }
  const actual = await inventory(target);
  if (!actual['deployggb.js'] || !actual[config.codebase + 'web3d.nocache.js']) {
    throw new Error('GeoGebra 入口文件缺失。');
  }
  if (Object.keys(actual).length !== Object.keys(manifest.files).length ||
      Object.entries(manifest.files).some(([name, hash]) => actual[name] !== hash)) {
    throw new Error('GeoGebra 本地资源缺失或损坏。');
  }
  return Object.keys(actual).length;
}

async function install() {
  try {
    console.log(`GeoGebra ${config.version} 已安装，校验 ${await verify()} 个文件；无需联网。`);
    return;
  } catch { /* 首次安装或修复损坏资源。 */ }
  const work = await mkdtemp(join(tmpdir(), 'mathmover-geogebra-'));
  try {
    const archive = process.argv[3];
    let bytes;
    if (archive) bytes = await readFile(resolve(archive));
    else {
      // 主源是仓库自己的 Release 资产（GitHub runner 访问官方下载源会失败），
      // 官方地址留作回退；两个都过同一个 SHA-256 校验。
      const urls = [config.url, ...(config.fallbackUrls ?? [])];
      let lastError;
      for (const url of urls) {
        try {
          console.log(`下载 GeoGebra ${config.version}（约 32 MB）：${url}`);
          const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          bytes = Buffer.from(await response.arrayBuffer());
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          console.warn(`下载失败：${error instanceof Error ? error.message : error}`);
        }
      }
      if (!bytes) throw new Error(`所有下载源都失败：${lastError instanceof Error ? lastError.message : lastError}`);
    }
    if (digest(bytes) !== config.sha256) throw new Error('运行库 SHA-256 校验失败，未安装。');
    const zip = join(work, 'bundle.zip');
    const extracted = join(work, 'extracted');
    await writeFile(zip, bytes);
    // 只解压校验通过的固定官方归档，保留全部运行库和字体许可。
    if (process.platform === 'win32') {
      const quote = value => "'" + value.replaceAll("'", "''") + "'";
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(extracted)}`]);
    } else execFileSync('unzip', ['-q', zip, '-d', extracted]);
    const source = join(extracted, 'GeoGebra');
    await readFile(join(source, config.codebase, 'web3d.nocache.js'));
    const files = await inventory(source);
    await writeFile(join(source, 'installed.json'), JSON.stringify({ ...config, files }, null, 2));
    await mkdir(dirname(target), { recursive: true });
    // 不覆盖或删除现有资源：损坏版本保留为备份，便于恢复。
    try { await rename(target, target + '.backup-' + Date.now()); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await cp(source, target, { recursive: true, errorOnExist: true, force: false });
    console.log(`GeoGebra ${config.version} 安装完成，校验 ${await verify()} 个文件。`);
  } finally {
    // work 是 mkdtemp 创建的专用临时目录，不是用户或项目目录。
    await rm(work, { recursive: true, force: true });
  }
}

try {
  if (process.argv[2] === 'install') await install();
  else console.log(`GeoGebra ${config.version} 本地资源完整：${await verify()} 个文件。`);
} catch (error) {
  console.error(`${error.message}\n请联网运行 npm run ggb:install，或指定已下载的官方 ZIP：npm run ggb:install -- <路径>`);
  process.exitCode = 1;
}
