import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openCodePaths, opencode, resolveRuntimeTarget, spawnCapture } from '../../../packages/agent-runtime/src/index.ts';

// Next's Node 20 type package predates node:sqlite; the runtime is the same Node 24
// already required by the daemon's courseware store.
type Row = Record<string, string | number | bigint | null | Uint8Array>;
// Resolve through Node directly: Turbopack cannot externalize this module through
// createRequire(import.meta.url), even though it is available in the bundled Node.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as unknown as {
  DatabaseSync: new (file: string, options: { readOnly: true }) => {
    prepare(sql: string): { get(...values: unknown[]): Row | undefined; all(...values: unknown[]): Row[] };
    close(): void;
  };
};
const pending = new Map<string, Promise<string | undefined>>();

function sameDirectory(a: string, b: string) {
  const normalize = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(a) === normalize(b);
}

function readSession(database: string, sessionId: string, directory: string, exportMessages = false) {
  if (!fs.existsSync(database)) return undefined;
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session'").get()) return undefined;
    const row = db.prepare('SELECT * FROM session WHERE id=?').get(sessionId);
    if (!row || typeof row.directory !== 'string' || !sameDirectory(row.directory, directory)) return undefined;
    if (!exportMessages) return { info: { id: sessionId }, messages: [] };
    // Public `opencode import` format, reconstructed from a read-only connection.
    // Only the requested MathMover workspace is exported, never the shared DB or auth/config files.
    const info = {
      id: row.id, slug: row.slug, projectID: row.project_id, directory: row.directory,
      title: row.title, version: row.version,
      ...(row.parent_id ? { parentID: row.parent_id } : {}),
      ...(row.permission ? { permission: JSON.parse(String(row.permission)) } : {}),
      time: { created: row.time_created, updated: row.time_updated,
        ...(row.time_compacting ? { compacting: row.time_compacting } : {}),
        ...(row.time_archived ? { archived: row.time_archived } : {}) },
    };
    const messages = db.prepare('SELECT * FROM message WHERE session_id=? ORDER BY time_created,id').all(sessionId).map(message => ({
      info: { ...JSON.parse(String(message.data)), id: message.id, sessionID: sessionId },
      parts: db.prepare('SELECT * FROM part WHERE message_id=? AND session_id=? ORDER BY id').all(message.id, sessionId).map(part => ({
        ...JSON.parse(String(part.data)), id: part.id, messageID: message.id, sessionID: sessionId,
      })),
    }));
    return { info, messages };
  } finally { db.close(); }
}

/** Adopt only this courseware's old native transcript once. Future resumes stay entirely
 * in the private DB. If no native transcript exists, the caller rebuilds from saved chat.
 * Import errors are surfaced before any model request, never silently dropping context.
 */
export async function prepareOpenCodeSession(options: {
  sessionId?: string; dataDirectory: string; directory: string; env: NodeJS.ProcessEnv;
  legacyDataDirectory?: string;
}): Promise<string | undefined> {
  const { sessionId } = options;
  if (!sessionId) return undefined;
  const paths = openCodePaths(options.dataDirectory);
  const database = path.join(paths.data, 'opencode.db');
  if (readSession(database, sessionId, options.directory)) return sessionId;
  const key = `${database}:${options.directory}:${sessionId}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const migrate = async () => {
    const legacy = options.legacyDataDirectory ?? path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'opencode');
    const exported = readSession(path.join(legacy, 'opencode.db'), sessionId, options.directory, true);
    if (!exported) return undefined;
    const target = resolveRuntimeTarget(opencode);
    if (!target) throw new Error('内置 Agent 运行时不可用，无法恢复原会话。');
    const file = path.join(paths.temp, `session-${randomUUID()}.json`);
    try {
      fs.writeFileSync(file, JSON.stringify(exported), { mode: 0o600, flag: 'wx' });
      const result = await spawnCapture(target.command, [...target.prefixArgs, 'import', file], {
        cwd: options.directory, timeoutMs: 30_000,
        env: { ...options.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ autoupdate: false, share: 'disabled', agent: { title: { disable: true } } }) },
      });
      if (result.failed || result.status !== 0 || !readSession(database, sessionId, options.directory)) {
        throw new Error('原会话迁移到内置 Agent 独立目录失败，尚未调用模型；请稍后重试。');
      }
      return sessionId;
    } finally { fs.rmSync(file, { force: true }); }
  };
  const job = migrate();
  pending.set(key, job);
  try { return await job; } finally { pending.delete(key); }
}
