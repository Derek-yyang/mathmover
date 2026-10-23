/** Real Electron/Sparkle installation on macOS, using isolated apps, data and an ephemeral key. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, createPrivateKey, createPublicKey } from 'node:crypto';
assert.equal(process.platform, 'darwin');
const require = createRequire(import.meta.url);
const desktop = path.resolve(import.meta.dirname, '..');
const { createPackageWithOptions } = require(path.join(desktop, 'node_modules/@electron/asar'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mathmover-sparkle-test-'));
console.log(`Update test artifacts: ${root}`);
const vendor = path.join(desktop, 'node_modules/electron-sparkle-updater/native/vendor');
const packageRoot = path.join(desktop, 'node_modules/electron-sparkle-updater');
const archiveDir = path.join(root, 'archives'); fs.mkdirSync(archiveDir);
const data = path.join(root, 'data'); fs.mkdirSync(data);
fs.writeFileSync(path.join(data, 'courseware.json'), '{"sentinel":"keep my courseware"}');
const sentinel = fs.readFileSync(path.join(data, 'courseware.json'));
const seed = randomBytes(32);
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
const publicEdKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const keyFile = path.join(root, 'test-seed'); fs.writeFileSync(keyFile, seed.toString('base64'), { mode: 0o600 });
let good = false; let currentFeed; const requests = [];
const server = http.createServer((req, res) => {
  requests.push(req.url);
  if (req.url?.split('?')[0] === '/appcast.xml') { res.setHeader('Content-Type', 'application/xml'); res.end(fs.readFileSync(currentFeed)); return; }
  const file = path.join(archiveDir, path.basename(new URL(req.url, 'http://localhost').pathname));
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Length', fs.statSync(file).size); fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const feedUrl = `http://127.0.0.1:${server.address().port}/appcast.xml`;
const bundleId = `com.mathmover.updatetest.t${Date.now()}`;
const plist = (app, command) => execFileSync('/usr/libexec/PlistBuddy', ['-c', command, path.join(app, 'Contents/Info.plist')]);
let child; let logs = '';
try {
  for (const version of ['0.0.4', '0.0.5']) {
    const app = path.join(root, version, 'MathMover.app'); fs.mkdirSync(path.dirname(app));
    execFileSync('/usr/bin/ditto', [path.join(desktop, 'node_modules/electron/dist/Electron.app'), app]);
    const contents = path.join(app, 'Contents'); const resources = path.join(contents, 'Resources');
    fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
    execFileSync('/usr/bin/ditto', [path.join(vendor, 'Sparkle.framework'), path.join(contents, 'Frameworks/Sparkle.framework')]);
    for (const [key, value] of Object.entries({ CFBundleIdentifier: bundleId, CFBundleName: 'MathMoverUpdateTest', CFBundleVersion: version, CFBundleShortVersionString: version })) plist(app, `Set :${key} ${value}`);
    plist(app, 'Add :SUEnableInstallerLauncherService bool false');
    plist(app, 'Add :SURequireSignedFeed bool true');
    plist(app, 'Add :SUVerifyUpdateBeforeExtraction bool true');
    plist(app, `Add :SUPublicEDKey string ${publicEdKey}`);
    plist(app, `Add :SUFeedURL string ${feedUrl}`);
    // Electron already ships an ATS dictionary. This isolated fixture uses HTTP loopback only.
    plist(app, 'Delete :NSAppTransportSecurity');
    plist(app, 'Add :NSAppTransportSecurity dict');
    plist(app, 'Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true');
    const source = path.join(root, `source-${version}`); fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: 'mathmover-update-test', version, main: 'main.cjs' }));
    fs.copyFileSync(path.join(desktop, 'src/sparkle-updates.cjs'), path.join(source, 'sparkle-updates.cjs'));
    const moduleDir = path.join(source, 'node_modules/electron-sparkle-updater'); fs.mkdirSync(moduleDir, { recursive: true });
    for (const name of ['package.json', 'dist']) fs.cpSync(path.join(packageRoot, name), path.join(moduleDir, name), { recursive: true });
    fs.mkdirSync(path.join(moduleDir, 'native/build/Release'), { recursive: true });
    fs.copyFileSync(path.join(packageRoot, 'native/build/Release/sparkle_bridge.node'), path.join(moduleDir, 'native/build/Release/sparkle_bridge.node'));
    // Both versions use a fixed temporary data directory; relaunch needs no inherited env.
    fs.writeFileSync(path.join(source, 'main.cjs'), `
const {app,BrowserWindow}=require('electron');const fs=require('node:fs');const path=require('node:path');
const data=${JSON.stringify(data)}; app.setPath('userData',path.join(data,'profile'));
const record=e=>fs.appendFileSync(path.join(data,'events.jsonl'),JSON.stringify(e)+'\\n');
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false});
  record({type:'launched',version:app.getVersion(),sentinel:fs.readFileSync(path.join(data,'courseware.json'),'utf8')});
  if(app.getVersion()==='0.0.5'){setTimeout(()=>app.quit(),1000);return;}
  const {loadSparkleBridgeForApp}=await import('electron-sparkle-updater');
  const bridge=await loadSparkleBridgeForApp(console.log); if(!bridge)throw Error('Native addon unavailable');
  const original=bridge.setEventHandler; bridge.setEventHandler=handler=>original(handler?e=>{record(e);handler(e);if(e.type==='error')setTimeout(()=>updater.check({silent:true}),2500);}:null);
  const {createSparkleUpdater}=require('./sparkle-updates.cjs');
  const updater=createSparkleUpdater({loadBridge:async()=>bridge,config:${JSON.stringify({ feedUrl, publicEdKey })},fallback:{check:()=>{throw Error('Unexpected manual fallback');}},showMessageBox:async()=>0,openExternal:()=>{},log:console.log});
  await updater.init(); bridge.setAutomaticChecks(false); await updater.check({silent:true});
  app.on('will-quit',()=>updater.dispose());
}).catch(e=>{record({type:'harness-error',message:e.stack});app.exit(1);});
`);
    await createPackageWithOptions(source, path.join(resources, 'app.asar'), { unpack: '**/*.node' });
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    if (version === '0.0.5') execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, path.join(archiveDir, 'MathMover-0.0.5.zip')]);
  }
  execFileSync(path.join(vendor, 'bin/generate_appcast'), ['--ed-key-file', keyFile, '--maximum-deltas', '0', '--download-url-prefix', feedUrl.replace('/appcast.xml', '/'), archiveDir], { stdio: 'inherit' });
  const xml = fs.readFileSync(path.join(archiveDir, 'appcast.xml'), 'utf8');
  const validFeed = path.join(root, 'valid.xml'); fs.writeFileSync(validFeed, xml);
  const badFeed = path.join(root, 'bad.xml'); fs.writeFileSync(badFeed, xml.replaceAll('MathMover-0.0.5.zip', 'tampered.zip'));
  const tampered = fs.readFileSync(path.join(archiveDir, 'MathMover-0.0.5.zip')); tampered[tampered.length - 1] ^= 1;
  fs.writeFileSync(path.join(archiveDir, 'tampered.zip'), tampered);
  for (const feed of [validFeed, badFeed]) execFileSync(path.join(vendor, 'bin/sign_update'), ['--ed-key-file', keyFile, feed]);
  currentFeed = badFeed;
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(path.join(root, '0.0.4/MathMover.app/Contents/MacOS/Electron'), [], { stdio: ['ignore', 'pipe', 'pipe'], env });
  child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  const deadline = Date.now() + 180_000;
  let events = [];
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const file = path.join(data, 'events.jsonl');
    events = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    if (events.some(e => e.type === 'harness-error')) throw Error(JSON.stringify(events));
    if (!good && events.some(e => e.type === 'error')) {
      assert(!events.some(e => e.type === 'update-downloaded'), 'Tampered archive must never become ready');
      assert(events.some(e => /signature|验证|签名/i.test(e.message || '')), 'Expected cryptographic verification error');
      console.log('PASS: signed feed pointing at tampered archive was rejected');
      good = true; currentFeed = validFeed;
    }
    if (events.some(e => e.type === 'launched' && e.version === '0.0.5')) break;
  }
  assert(good, 'Tampered archive was not rejected');
  assert(requests.includes('/MathMover-0.0.5.zip'), 'Real archive was not downloaded');
  assert(events.some(e => e.type === 'update-downloaded'), 'Verified update was not staged');
  assert(events.some(e => e.type === 'launched' && e.version === '0.0.5'), 'Sparkle did not install and relaunch newer app');
  assert.deepEqual(fs.readFileSync(path.join(data, 'courseware.json')), sentinel);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(root, '0.0.4/MathMover.app')]);
  console.log('PASS: real Electron bridge downloaded, verified, installed and relaunched 0.0.4 -> 0.0.5; user data preserved');
} finally {
  fs.writeFileSync(path.join(root, 'native-output.log'), logs);
  fs.writeFileSync(path.join(root, 'requests.json'), JSON.stringify(requests));
  if (child?.exitCode === null) child.kill('SIGTERM');
  fs.rmSync(keyFile, { force: true });
  server.closeAllConnections(); server.close();
}
