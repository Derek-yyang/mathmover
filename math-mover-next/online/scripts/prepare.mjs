import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { openCodePluginDependencyDirectories } from '../../../packages/agent-runtime/src/opencode-plugin-dependencies.ts';

const frontend = path.resolve(import.meta.dirname, '../..');
const online = path.join(frontend, 'online');
const root = path.dirname(frontend);
fs.mkdirSync(path.join(online, 'runtime'), { recursive: true });
fs.writeFileSync(path.join(online, 'runtime-trace.json'), JSON.stringify(openCodePluginDependencyDirectories().map(directory => `${path.relative(online, directory).replaceAll(path.sep, '/')}/**/*`)));
await build({ entryPoints: [path.join(root, 'packages/daemon/src/mcp-stdio.ts')],
  outfile: path.join(online, 'runtime/mcp.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24',
  // Asset root is supplied by the run. import.meta is never used for root discovery here.
});
fs.cpSync(path.join(frontend, 'public'), path.join(online, 'public'), { recursive: true });
// @vercel/functions imports ws at runtime. Keep it under the app root so it is
// resolvable from the generated route module and included by the function trace.
fs.cpSync(path.join(frontend, 'node_modules/ws'), path.join(online, 'node_modules/ws'), { recursive: true });
// Keep the shared knowledge assets in a known, traced location in the function bundle.
fs.copyFileSync(path.join(root, 'ggb_commands.json'), path.join(online, 'runtime/ggb_commands.json'));
fs.cpSync(path.join(root, 'skills'), path.join(online, 'runtime/skills'), { recursive: true });
console.log('Online runtime and GeoGebra assets prepared.');
