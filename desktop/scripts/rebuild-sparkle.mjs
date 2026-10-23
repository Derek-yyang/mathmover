import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (process.platform === 'darwin') {
  execFileSync(process.execPath, [
    'node_modules/electron-sparkle-updater/bin/electron-sparkle-updater.js',
    'rebuild', '--electron-version', require('electron/package.json').version, '--arch', process.arch,
  ], { stdio: 'inherit' });
}
