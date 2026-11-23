import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..');
const require = createRequire(path.join(repo, 'package.json'));
const { build } = require('esbuild');
const web = path.join(repo, 'math-mover-next');
const runtime = JSON.parse(await fs.readFile(path.join(web, 'geogebra-runtime.json'), 'utf8'));
const vendor = path.join(web, 'public/vendor/geogebra', runtime.version);
const manifest = JSON.parse(await fs.readFile(path.join(vendor, 'installed.json'), 'utf8').catch(() => {
  throw new Error('请先在 math-mover-next 安装本地 GeoGebra 资源，再构建 MCP 包。');
}));
if (manifest.sha256 !== runtime.sha256) throw new Error('GeoGebra 安装记录不匹配');
const dist = path.join(root, 'dist');
await fs.mkdir(dist, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: { cli: 'src/cli.ts', runtime: 'src/runtime.ts' },
  outdir: dist, outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node',
  format: 'cjs', target: 'node22', logLevel: 'warning',
});
await build({
  absWorkingDir: root, entryPoints: ['src/canvas.tsx'], outfile: path.join(dist, 'public/canvas.js'),
  bundle: true, platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic',
  alias: { '@': web }, nodePaths: [path.join(web, 'node_modules')],
  // Reuse raw GeoGebra operations while isolating MCP view ownership from
  // the Web/Desktop window-binding and reconnection policy.
  plugins: [{
    name: 'mcp-canvas-connection',
    setup(build) {
      build.onResolve({ filter: /^\.\/ggb-connection$/ }, args => {
        if (path.resolve(args.importer) === path.join(web, 'lib/ggb-bridge.ts')) {
          return { path: path.join(root, 'src/connection.ts') };
        }
      });
    },
  }],
  define: { 'process.env.NODE_ENV': '"production"' }, minify: true, logLevel: 'warning',
});
await fs.copyFile(path.join(root, 'src/index.html'), path.join(dist, 'public/index.html'));
await fs.cp(vendor, path.join(dist, 'public/vendor/geogebra', runtime.version), { recursive: true });
for (const entry of ['skills', 'ggb_commands.json']) {
  await fs.cp(path.join(repo, entry), path.join(dist, 'assets', entry), { recursive: true });
}
for (const entry of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  await fs.copyFile(path.join(repo, entry), path.join(root, entry));
}
console.log(`MathMover MCP 构建完成：${dist}`);
