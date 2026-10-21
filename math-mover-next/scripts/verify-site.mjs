import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../site/out/', import.meta.url));
const html = await readFile(path.join(output, 'index.html'), 'utf8');
assert.ok(html.includes('让数学问题，'), 'Homepage content is missing');
assert.ok(html.includes('id="examples"'), 'Examples section is missing');
assert.ok(html.includes('id="questions"'), 'FAQ section is missing');
assert.ok(!/(?:href|src)="\/(?:dashboard|api)(?:[\/"?#])/.test(html), 'Workbench or API entry leaked into the site');
const download = 'https://github.com/Derek-yyang/mathmover/releases/latest/download/MathMover-Setup.exe';
assert.equal(html.split(`href="${download}"`).length - 1, 4, 'Expected four installer download links');
await stat(path.join(output, '404.html'));

// Verify every generated page asset can be served directly from the export.
const assets = [...html.matchAll(/(?:src|href)="([^"?#]+)(?:[?#][^"]*)?"/g)]
  .map(match => match[1]).filter(value => value.startsWith('/_next/') || value === '/icon.svg');
assert.ok(assets.some(asset => asset.endsWith('.js')), 'Client-side scripts are missing');
assert.ok(assets.some(asset => asset.endsWith('.css')), 'Stylesheets are missing');
for (const asset of new Set(assets)) await stat(path.join(output, asset));

let files = 0;
let bytes = 0;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      assert.ok(!['api', 'dashboard', 'vendor', 'node_modules'].includes(entry.name), `Unexpected published directory: ${fullPath}`);
      await inspect(fullPath);
    } else {
      assert.ok(!/\.(?:exe|blockmap|map)$/.test(entry.name), `Unexpected published file: ${fullPath}`);
      const info = await stat(fullPath);
      assert.ok(info.size <= 25 * 1024 * 1024, `Asset exceeds Cloudflare Pages' 25 MiB limit: ${fullPath}`);
      files++;
      bytes += info.size;
    }
  }
}
await inspect(output);
assert.ok(files <= 20000, 'Export exceeds Cloudflare Pages Free file limit');
console.log(`Static homepage verified: ${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB (${output})`);
