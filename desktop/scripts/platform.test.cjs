const { test } = require('node:test');
const assert = require('node:assert/strict');
const { opencodePackages, macPath } = require('../src/platform.cjs');

test('OpenCode 按系统与 CPU 选择，禁止把 Intel 二进制装入 Apple 芯片包', () => {
  const installed = ['opencode-ai', 'opencode-darwin-x64', 'opencode-darwin-arm64',
    'opencode-windows-x64-baseline', 'opencode-windows-x64', 'opencode-linux-arm64'];
  assert.deepEqual(opencodePackages(installed, 'darwin', 'arm64'), ['opencode-darwin-arm64']);
  assert.deepEqual(opencodePackages(installed, 'win32', 'x64'), ['opencode-windows-x64', 'opencode-windows-x64-baseline']);
  assert.deepEqual(opencodePackages(installed, 'darwin', 'ppc'), []);
});

test('Finder PATH 保留登录 shell 的 Agent 路径，同时让脚本使用随包 Node', () => {
  const value = macPath({ nodeDir: '/Applications/MathMover.app/Contents/Resources/node',
    shellPath: '/Users/test/.nvm/versions/node/v24/bin:/opt/homebrew/bin:/usr/bin',
    inheritedPath: '/usr/bin:/bin', home: '/Users/test' });
  const dirs = value.split(':');
  assert.equal(dirs[0], '/Applications/MathMover.app/Contents/Resources/node');
  assert(dirs.includes('/Users/test/.nvm/versions/node/v24/bin'));
  assert(dirs.includes('/Users/test/.local/bin'));
  assert(dirs.includes('/opt/homebrew/bin'));
  assert.equal(dirs.filter(dir => dir === '/usr/bin').length, 1);
  assert(!dirs.includes(''), '不能引入空 PATH 段（当前目录）');
});

test('登录 shell 不可用时仍能找到常见的 Agent 安装目录', () => {
  const dirs = macPath({ nodeDir: '/app/node', home: '/Users/test' }).split(':');
  for (const dir of ['/app/node', '/Users/test/.volta/bin', '/usr/local/bin', '/bin']) assert(dirs.includes(dir));
});
