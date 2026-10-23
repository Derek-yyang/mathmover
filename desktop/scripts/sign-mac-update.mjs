/** Sign the archive AND feed. The persistent private seed is only supplied by CI. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';
const desktop = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(desktop, 'src/sparkle-config.json')));
const version = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'))).version;
const seed = Buffer.from(process.env.SPARKLE_ED_PRIVATE_KEY || '', 'base64');
if (process.platform !== 'darwin' || seed.length !== 32) throw Error('macOS and Sparkle signing seed required');
const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), type: 'pkcs8', format: 'der' });
if (createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64') !== config.publicEdKey) throw Error('Signing key does not match shipped public key');
const tools = path.join(desktop, 'node_modules/electron-sparkle-updater/native/vendor/bin');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'mathmover-appcast-'));
const keyFile = path.join(folder, 'private-seed');
try {
  fs.writeFileSync(keyFile, seed.toString('base64'), { mode: 0o600, flag: 'wx' });
  const archives = path.join(folder, 'archives');
  fs.mkdirSync(archives);
  const name = `MathMover-${version}-mac-arm64.zip`;
  fs.copyFileSync(path.join(desktop, 'release', name), path.join(archives, name));
  execFileSync(path.join(tools, 'generate_appcast'), [
    '--ed-key-file', keyFile, '--maximum-deltas', '0', '--maximum-versions', '1',
    '--download-url-prefix', `https://github.com/Derek-yyang/mathmover/releases/download/v${version}/`,
    '--full-release-notes-url', `https://github.com/Derek-yyang/mathmover/releases/tag/v${version}`, archives,
  ], { stdio: 'inherit' });
  // generate_appcast derives the feed filename from the packaged app's SUFeedURL.
  const feed = path.join(archives, path.basename(new URL(config.feedUrl).pathname));
  execFileSync(path.join(tools, 'sign_update'), ['--ed-key-file', keyFile, feed], { stdio: 'inherit' });
  execFileSync(path.join(tools, 'sign_update'), ['--ed-key-file', keyFile, '--verify', feed], { stdio: 'inherit' });
  fs.copyFileSync(feed, path.join(desktop, 'release/appcast-mac-arm64.xml'));
} finally {
  if (fs.existsSync(keyFile)) { fs.writeFileSync(keyFile, Buffer.alloc(fs.statSync(keyFile).size)); fs.unlinkSync(keyFile); }
  fs.rmSync(folder, { recursive: true, force: true });
}
