import fs from 'node:fs';
import path from 'node:path';
import { seedOpenCodePluginDependencies } from './opencode-plugin-dependencies.ts';

/** The pinned CLI's internal v2 plugin loader ignores DISABLE_PROJECT_CONFIG.
 * MathMover owns its workspaces and never writes OpenCode project configuration.
 * Refuse unexpected config anywhere on the discovery path before starting the CLI;
 * do not delete or rewrite another application's files to achieve isolation.
 */
export function assertOpenCodeWorkspaceIsolated(workspace: string): void {
  let directory = path.resolve(workspace);
  while (true) {
    for (const name of ['opencode.json', 'opencode.jsonc', '.opencode']) {
      const file = path.join(directory, name);
      if (fs.existsSync(file)) {
        throw new Error(`内置 Agent 工作目录发现外部 OpenCode 配置，已停止启动以保持隔离：${file}`);
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

/** Persistent, application-owned paths. Never point the embedded CLI at user-level OpenCode data. */
export function openCodePaths(dataDirectory: string) {
  const root = path.resolve(dataDirectory, 'runtime', 'opencode');
  return {
    root,
    home: path.join(root, 'home'),
    config: path.join(root, 'config', 'opencode'),
    data: path.join(root, 'data', 'opencode'),
    cache: path.join(root, 'cache', 'opencode'),
    state: path.join(root, 'state', 'opencode'),
    temp: path.join(root, 'tmp'),
    managed: path.join(root, 'managed'),
  };
}

/** Only for the bundled BYOK runtime, not the user's separately configured local agents.
 * Explicit undefined entries remove inherited OPENCODE_* variables even when runAgent
 * merges this environment with process.env. Proxy, certificates and OS launch variables survive.
 * The TEST_* names are the pinned 1.19.3 binary's supported home/managed-path overrides;
 * XDG paths separately control its database, auth, config, plugins and caches.
 */
export function createOpenCodeEnvironment(dataDirectory: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const paths = openCodePaths(dataDirectory);
  for (const directory of Object.values(paths)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  seedOpenCodePluginDependencies(paths.config, undefined, true);
  const env: NodeJS.ProcessEnv = { ...inherited };
  for (const key of Object.keys(env)) {
    if (/^OPENCODE(?:_|$)/i.test(key) || /^MATHMOVER_BYOK_API_KEY$/i.test(key)) env[key] = undefined;
  }
  return {
    ...env,
    HOME: paths.home,
    USERPROFILE: paths.home,
    APPDATA: path.join(paths.home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(paths.home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: path.dirname(paths.config),
    XDG_DATA_HOME: path.dirname(paths.data),
    XDG_CACHE_HOME: path.dirname(paths.cache),
    XDG_STATE_HOME: path.dirname(paths.state),
    XDG_CONFIG_DIRS: path.dirname(paths.config),
    XDG_DATA_DIRS: path.dirname(paths.data),
    XDG_RUNTIME_DIR: paths.temp,
    TMPDIR: paths.temp,
    TMP: paths.temp,
    TEMP: paths.temp,
    // MCP runs in a child of OpenCode; keep its library/token rooted at the real MathMover directory.
    MATHMOVER_DATA_DIR: path.resolve(dataDirectory),
    OPENCODE_TEST_HOME: paths.home,
    OPENCODE_TEST_MANAGED_CONFIG_DIR: paths.managed,
    // XDG_CONFIG_HOME isolates the global config; do not add another CONFIG_DIR.
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: '1',
  };
}
