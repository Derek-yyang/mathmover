/**
 * 打包 bundle：三个入口 → dist/，ESM、node24、依赖外置。
 * 外置是因为 dsh 的插件系统在 profile 的 node_modules 里解析 @deepseek-ai/*。
 */
import { build } from 'esbuild';

await build({
  bundle: true,
  entryPoints: {
    index: './src/index.ts',
    startup: './src/startup.ts',
    invariant: './src/invariant.ts',
  },
  format: 'esm',
  outdir: './dist',
  packages: 'external',
  platform: 'node',
  target: 'node24',
});

console.log('dsh-runtime: dist/ 已就绪');
