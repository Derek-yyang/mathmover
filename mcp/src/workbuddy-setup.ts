import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

type JsonObject = Record<string, unknown>;

export interface WorkBuddySetupOptions {
  configDir?: string;
  nodePath: string;
  cliPath: string;
  dataDir: string;
  dryRun?: boolean;
}

export interface WorkBuddySetupResult {
  configPath: string;
  backupPath?: string;
  changed: boolean;
  config: JsonObject;
  dryRun: boolean;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedPath(value: string) {
  return path.resolve(value).replaceAll('\\', '/');
}

export function defaultWorkBuddyConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
) {
  const configured = env.WORKBUDDY_CONFIG_DIR?.trim();
  if (configured) return path.resolve(configured);
  const dataFolder = env.WORKBUDDY_DATA_FOLDER_NAME?.trim() || '.workbuddy';
  return path.join(home, dataFolder);
}

export async function setupWorkBuddy(options: WorkBuddySetupOptions): Promise<WorkBuddySetupResult> {
  const configDir = path.resolve(options.configDir ?? defaultWorkBuddyConfigDir());
  const configPath = path.join(configDir, 'mcp.json');
  let current: JsonObject = {};
  let originalContent = '';

  try {
    originalContent = (await fs.readFile(configPath, 'utf8')).replace(/^\uFEFF/, '');
    const parsed: unknown = JSON.parse(originalContent);
    if (!isObject(parsed)) throw new Error('WorkBuddy mcp.json 顶层必须是 JSON 对象');
    current = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const currentServers = current.mcpServers;
  if (currentServers !== undefined && !isObject(currentServers)) {
    throw new Error('WorkBuddy mcp.json 中的 mcpServers 必须是 JSON 对象');
  }

  const mathmover = {
    type: 'stdio',
    command: normalizedPath(options.nodePath),
    args: [normalizedPath(options.cliPath)],
    env: {
      MATHMOVER_MCP_DATA_DIR: normalizedPath(options.dataDir),
    },
  };
  const next: JsonObject = {
    ...current,
    mcpServers: {
      ...(currentServers ?? {}),
      mathmover,
    },
  };
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (options.dryRun || !changed) {
    return { configPath, changed, config: next, dryRun: Boolean(options.dryRun) };
  }

  await fs.mkdir(configDir, { recursive: true });
  let backupPath: string | undefined;
  if (originalContent) {
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    backupPath = path.join(configDir, `mcp.json.backup-${timestamp}`);
    await fs.copyFile(configPath, backupPath);
  }

  const output = `${JSON.stringify(next, null, 2)}\n`;
  const temporaryPath = path.join(configDir, `.mcp.json.mathmover-${process.pid}.tmp`);
  await fs.writeFile(temporaryPath, output, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.rename(temporaryPath, configPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EEXIST') throw error;
    await fs.writeFile(configPath, output, { encoding: 'utf8', mode: 0o600 });
    await fs.rm(temporaryPath, { force: true });
  }
  return { configPath, backupPath, changed: true, config: next, dryRun: false };
}
