import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'site', 'out');
const runtime = JSON.parse(await readFile(path.join(root, 'geogebra-runtime.json'), 'utf8'));

await stat(path.join(output, 'index.html'));

const assets = [
  [path.join(root, 'public', 'workflow-preview'), path.join(output, 'workflow-preview')],
  [
    path.join(root, 'public', 'vendor', 'geogebra', runtime.version),
    path.join(output, 'vendor', 'geogebra', runtime.version),
  ],
];

for (const [source, destination] of assets) {
  await stat(source);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

console.log(`Copied homepage images and GeoGebra ${runtime.version} into ${output}.`);
