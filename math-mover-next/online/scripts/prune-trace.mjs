import fs from 'node:fs';
import path from 'node:path';

const serverDirectory = path.resolve(import.meta.dirname, '../.next/server');
const frontendRoot = path.resolve(import.meta.dirname, '../..');
const wsRoot = path.resolve(import.meta.dirname, '../node_modules/ws');
const wsFiles = fs.existsSync(wsRoot)
  ? fs.readdirSync(wsRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name))
  : [];
const ignored = [
  '/.next/cache/', '/.next/dev/', '/.next/standalone/',
  '/.next-desktop/', '/site/.next/', '/site/out/',
  '/public/vendor/', '/online/public/vendor/',
];

const tracePaths = fs.readdirSync(serverDirectory, { recursive: true })
  .filter((name) => `${name}`.endsWith('.nft.json'))
  .map((name) => path.join(serverDirectory, `${name}`));
let before = 0;
let after = 0;
for (const tracePath of tracePaths) {
  const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
  const pageDirectory = path.dirname(tracePath);
  if (tracePath.endsWith('/app/api/run/route.js.nft.json') || tracePath.endsWith('\\app\\api\\run\\route.js.nft.json')) {
    const existing = new Set(trace.files);
    for (const file of wsFiles) {
      const relative = path.relative(pageDirectory, file);
      if (!existing.has(relative)) trace.files.push(relative);
    }
  }
  const files = trace.files.filter((relative) => {
    const absolute = path.resolve(pageDirectory, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return false;
    const normalized = `/${path.relative(frontendRoot, absolute).replaceAll(path.sep, '/')}`;
    if (ignored.some((prefix) => normalized.includes(prefix))) return false;
    if (normalized.endsWith('.map')) return false;
    if (normalized.includes('/node_modules/') &&
        (normalized.endsWith('.ts') || normalized.endsWith('.tsx') ||
         normalized.endsWith('.d.ts') || normalized.endsWith('.md') ||
         normalized.includes('/test/') || normalized.includes('/tests/') ||
         normalized.includes('/fixtures/') || normalized.includes('/examples/'))) return false;
    return true;
  });
  before += trace.files.length;
  after += files.length;
  fs.writeFileSync(tracePath, JSON.stringify({ ...trace, files }));
}
console.log(`Pruned ${tracePaths.length} traces from ${before} to ${after} files.`);
