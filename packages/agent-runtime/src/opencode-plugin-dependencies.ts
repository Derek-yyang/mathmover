import fs from 'node:fs';
import path from 'node:path';

const PLUGIN = '@opencode-ai/plugin';
const VERSION = '1.19.3';

function packageDirectory(name: string, from: string): string {
  let directory = from;
  while (true) {
    const candidate = path.join(directory, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`缺少内置 Agent 依赖 ${name}，请重新安装 MathMover。`);
    directory = parent;
  }
}

function bundledPluginDirectory(): string {
  // Desktop prepare.mjs copies the complete SDK tree next to the bundled CLI.
  if (process.env.OPENCODE_BIN) {
    const candidate = path.join(path.dirname(process.env.OPENCODE_BIN), 'opencode-config', 'node_modules', PLUGIN);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  try { return packageDirectory(PLUGIN, process.cwd()); }
  catch { return packageDirectory(PLUGIN, path.join(process.cwd(), 'math-mover-next')); }
}

/** Build-time tracing for standalone Next installations, including transitive SDK dependencies. */
export function openCodePluginDependencyDirectories(source = bundledPluginDirectory()): string[] {
  const directories = new Set<string>();
  const visit = (directory: string) => {
    directory = fs.realpathSync(directory);
    if (directories.has(directory)) return;
    directories.add(directory);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    for (const name of Object.keys(manifest.dependencies ?? {})) visit(packageDirectory(name, directory));
  };
  visit(source);
  return [...directories];
}

/** OpenCode 1.19.3 waits for an SDK npm install before loading even a dependency-free
 * local plugin. Seed the actual pinned SDK and its dependencies from the application,
 * with matching npm metadata, so a fresh private home never needs a registry request.
 * No user caches or installed packages outside the application are adopted.
 */
export function seedOpenCodePluginDependencies(config: string, source = bundledPluginDirectory(), link = false): void {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (manifest.name !== PLUGIN || manifest.version !== VERSION) throw new Error('内置 Agent 插件依赖版本不匹配，请重新安装 MathMover。');
  const marker = path.join(config, '.mathmover-sdk-version');
  const installed = path.join(config, 'node_modules', PLUGIN);
  if (fs.existsSync(path.join(config, 'node_modules', PLUGIN, 'package.json')) &&
      fs.existsSync(path.join(config, 'package-lock.json')) && fs.existsSync(marker) &&
      fs.readFileSync(marker, 'utf8') === VERSION &&
      // An application update/move must not leave a junction to its old installation.
      (!link || fs.realpathSync(installed) === fs.realpathSync(source))) return;
  fs.mkdirSync(config, { recursive: true });
  const staging = fs.mkdtempSync(path.join(config, '.sdk-'));
  const dependencies = { [PLUGIN]: VERSION };
  const packages: Record<string, unknown> = { '': { name: 'mathmover-opencode-runtime', dependencies } };
  const copy = (directory: string, relative: string, ancestors: Set<string>) => {
    if (ancestors.has(directory)) throw new Error('内置 Agent 插件依赖存在循环。');
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const dest = path.join(staging, relative);
    fs.cpSync(directory, dest, { recursive: true, dereference: true,
      filter: file => file !== path.join(directory, 'node_modules') });
    packages[relative.replaceAll(path.sep, '/')] = {
      name: pkg.name, version: pkg.version, license: pkg.license,
      ...(pkg.dependencies ? { dependencies: pkg.dependencies } : {}),
    };
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      copy(packageDirectory(name, directory), path.join(relative, 'node_modules', name), new Set([...ancestors, directory]));
    }
  };
  try {
    if (link) {
      // Reuse only the SDK shipped with this application, never a user npm cache.
      // Junctions work without Windows developer mode; POSIX uses a directory symlink.
      const destination = path.join(staging, 'node_modules', PLUGIN);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.symlinkSync(path.resolve(source), destination, process.platform === 'win32' ? 'junction' : 'dir');
      packages[`node_modules/${PLUGIN}`] = { version: VERSION, dependencies: manifest.dependencies };
    } else copy(source, path.join('node_modules', PLUGIN), new Set());
    const modules = path.join(config, 'node_modules');
    // Only replace our application's own SDK tree, never a user-level directory.
    if (fs.existsSync(modules)) fs.rmSync(modules, { recursive: true, force: true });
    fs.renameSync(path.join(staging, 'node_modules'), modules);
    fs.writeFileSync(path.join(config, 'package.json'), JSON.stringify({ name: 'mathmover-opencode-runtime', private: true, dependencies }));
    fs.writeFileSync(path.join(config, 'package-lock.json'), JSON.stringify({ name: 'mathmover-opencode-runtime', lockfileVersion: 3, requires: true, packages }));
    fs.writeFileSync(marker, VERSION);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
}
