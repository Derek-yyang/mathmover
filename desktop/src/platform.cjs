const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

/** Node、Next 的原生依赖和 OpenCode 必须与构建机同架构，不能只改 Electron 的 --arch。 */
function opencodePackages(entries, platform, arch) {
  const system = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : platform;
  const base = `opencode-${system}-${arch}`;
  return entries.filter(name => name === base || name === `${base}-baseline`)
    .sort((a, b) => Number(a.endsWith('-baseline')) - Number(b.endsWith('-baseline')));
}

function macPath({ nodeDir, shellPath = '', inheritedPath = '', home = os.homedir() }) {
  return [...new Set([
    nodeDir,
    ...shellPath.split(':'),
    ...inheritedPath.split(':'),
    path.posix.join(home, '.local/bin'),
    path.posix.join(home, '.npm-global/bin'),
    path.posix.join(home, '.volta/bin'),
    path.posix.join(home, '.bun/bin'),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ].filter(Boolean))].join(':');
}

/** Finder 不继承终端 PATH。只读取登录 shell 的 PATH，不导入或记录其它环境变量。 */
async function restoreMacPath(nodeDir, log) {
  if (process.platform !== 'darwin') return;
  const marker = '__MATHMOVER_PATH__';
  const shell = process.env.SHELL || '/bin/zsh';
  const shellPath = await new Promise(resolve => {
    execFile(shell, ['-ilc', `printf '\\n${marker}%s\\n' "$PATH"`], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error) {
        log('读取登录 shell PATH 失败，使用常见安装路径');
        resolve('');
      } else {
        resolve(stdout.split(/\r?\n/).find(line => line.startsWith(marker))?.slice(marker.length) || '');
      }
    });
  });
  process.env.PATH = macPath({ nodeDir, shellPath, inheritedPath: process.env.PATH });
}

module.exports = { opencodePackages, macPath, restoreMacPath };
