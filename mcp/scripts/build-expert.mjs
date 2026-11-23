import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const mcpRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(mcpRoot, '..');
const templateDir = path.join(mcpRoot, 'workbuddy-expert');
const outputRoot = path.join(mcpRoot, '.expert-output');
const manifestPath = path.join(templateDir, '.codebuddy-plugin/plugin.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const expertName = manifest.name;
const stageRoot = path.join(outputRoot, expertName);
const zipPath = path.join(outputRoot, `${expertName}.zip`);
const avatarSource = path.join(repoRoot, 'desktop/build-resources/icon.png');

await fs.access(avatarSource);
await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });
await fs.cp(templateDir, stageRoot, { recursive: true });
await fs.rm(path.join(stageRoot, '.mcp.json'), { force: true });
await fs.rm(path.join(stageRoot, 'bin'), { recursive: true, force: true });
await fs.rm(path.join(stageRoot, 'runtime'), { recursive: true, force: true });
await fs.mkdir(path.join(stageRoot, 'avatars'), { recursive: true });
await fs.copyFile(avatarSource, path.join(stageRoot, 'avatars/mathmover.png'));

const required = [
  '.codebuddy-plugin/plugin.json',
  `agents/${manifest.agentName}.md`,
  'skills/mathmover-workbuddy/SKILL.md',
  'skills/mathmover-workbuddy/bootstrap.ps1',
  'avatars/mathmover.png',
  'package.json',
];
for (const relative of required) await fs.access(path.join(stageRoot, relative));
for (const forbidden of ['.mcp.json', 'bin', 'runtime']) {
  try {
    await fs.access(path.join(stageRoot, forbidden));
    throw new Error(`Unexpected bundled MCP component in expert package: ${forbidden}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

async function listFiles(root, current = root) {
  const files = [];
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute));
  }
  return files.sort((a, b) => a.localeCompare(b));
}

const files = await listFiles(stageRoot);
const localParts = [];
const centralParts = [];
let offset = 0;
const { time, date } = dosDateTime(new Date());
for (const relative of files) {
  const absolute = path.join(stageRoot, relative);
  const source = await fs.readFile(absolute);
  const compressed = zlib.deflateRawSync(source, { level: 9 });
  const name = Buffer.from(`${expertName}/${relative.split(path.sep).join('/')}`, 'utf8');
  const checksum = crc32(source);
  const executable = relative === path.join('bin', 'run-node');
  const externalAttributes = executable ? (0o100755 << 16) >>> 0 : (0o100644 << 16) >>> 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(source.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  localParts.push(local, name, compressed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(source.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(externalAttributes, 38);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, name);
  offset += local.length + name.length + compressed.length;
}

const centralDirectory = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralDirectory.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);
await fs.writeFile(zipPath, Buffer.concat([...localParts, centralDirectory, end]));

console.log(`MathMover WorkBuddy Expert staged: ${stageRoot}`);
console.log(`Package: ${zipPath}`);
console.log(`Files: ${files.length}, ${(await fs.stat(zipPath)).size} bytes`);
