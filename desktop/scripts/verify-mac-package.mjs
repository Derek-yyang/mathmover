/** 在 macOS runner 上验证真实 .app 及安装镜像，不能用 Windows 构建通过代替。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64');
const app = path.resolve('desktop/release/mac-arm64/MathMover.app');
const resources = path.join(app, 'Contents/Resources');
const binaries = [
  path.join(app, 'Contents/MacOS/MathMover'),
  path.join(resources, 'node/node'),
  path.join(resources, 'bin/opencode'),
];
for (const file of binaries) {
  fs.accessSync(file, fs.constants.X_OK);
  const type = execFileSync('/usr/bin/file', ['-b', file], { encoding: 'utf8' });
  assert.match(type, /arm64/, `错架构：${file}: ${type}`);
}
for (const executable of binaries.slice(1)) {
  console.log(execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 30_000 }).trim());
}
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
const plist = path.join(app, 'Contents/Info.plist');
const icon = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIconFile', plist], { encoding: 'utf8' }).trim();
assert(fs.existsSync(path.join(resources, icon)), `缺少 Dock 图标：${icon}`);
const version = JSON.parse(fs.readFileSync('desktop/package.json', 'utf8')).version;
const dmg = path.resolve(`desktop/release/MathMover-${version}-mac-arm64.dmg`);
const zip = path.resolve(`desktop/release/MathMover-${version}-mac-arm64.zip`);
assert(fs.statSync(zip).size > 0);
execFileSync('/usr/bin/hdiutil', ['verify', dmg], { stdio: 'inherit' });
console.log('PASS: .app 三个二进制均为 arm64、可执行且可启动；本地签名、Dock 图标、DMG 校验通过');
