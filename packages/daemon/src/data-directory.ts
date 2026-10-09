import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

/** User data, never installation/cwd. Both the local Next server and daemon use this. */
export function dataDirectory(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (env.MATHMOVER_DATA_DIR) return path.resolve(env.MATHMOVER_DATA_DIR);
  const base = platform === 'win32' ? env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    : platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'MathMover');
}

export function libraryToken(root = dataDirectory(), create = false): string {
  const file = path.join(root, '.local-access-token');
  if (create) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600, flush: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  }
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('本地访问令牌不能是符号链接');
  const token = fs.readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('本地访问令牌损坏，请勿自动覆盖');
  return token;
}
