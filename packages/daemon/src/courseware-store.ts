import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dataDirectory } from './data-directory.ts';
import { validateGgbSnapshot } from './ggb-snapshot.ts';
import { CoursewareError, type CoursewareSummary } from '@mathmover/ggb-core';
// Resolve the native module in Node, including test runners predating node:sqlite.
const { DatabaseSync, backup } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export interface CoursewareInput {
  id: string; expectedRevision: number; title: string;
  commands: string[]; messages: unknown[]; ggbBase64?: string;
  view?: { showAxes: boolean; showGrid: boolean; bounds?: [number, number, number, number] };
  runtimeId?: string; sessionId?: string; created_at?: string;
}
type Row = CoursewareSummary & { payload: string; snapshot: string | null };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const HASH = /^[a-f0-9]{64}$/;
function validId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !ID.test(id)) throw new CoursewareError(400, '课件 ID 不合法');
}
function bytes(base64: string, limit: number): Buffer {
  if (!base64 || base64.length > Math.ceil(limit * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
    throw new CoursewareError(400, '资源编码无效或超过大小限制');
  const b = Buffer.from(base64, 'base64');
  if (b.length > limit || b.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, ''))
    throw new CoursewareError(400, '资源编码无效');
  return b;
}

/** Files are content-addressed and immutable; DB references are committed only AFTER durable writes.
 * Failed transactions may leave orphan resources, but never overwrite a valid revision.
 * No automatic deletion/pruning of history or orphan files. */
export class CoursewareStore {
  readonly root: string;
  readonly db: import('node:sqlite').DatabaseSync;
  constructor(root = dataDirectory()) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = fs.realpathSync(root);
    for (const dir of ['coursewares', 'assets', 'backups', 'trash']) this.safeDirectory(dir);
    const dbPath = this.file('library.sqlite');
    this.db = new DatabaseSync(dbPath);
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const check = this.db.prepare('PRAGMA quick_check').get();
      if (Object.values(check ?? {})[0] !== 'ok') throw new Error('课件数据库校验失败，原文件未被重置');
      const version = Number(Object.values(this.db.prepare('PRAGMA user_version').get() ?? {})[0]);
      if (version > 1) throw new Error('课件库由较新版本创建，请升级程序');
      if (!version) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE coursewares (id TEXT PRIMARY KEY, title TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL, deleted_at TEXT);
        CREATE TABLE revisions (id TEXT NOT NULL REFERENCES coursewares(id), revision INTEGER NOT NULL,
          payload TEXT NOT NULL, snapshot TEXT, saved_at TEXT NOT NULL, PRIMARY KEY(id, revision));
        CREATE INDEX recent_coursewares ON coursewares(updated_at DESC);
        PRAGMA user_version=1; COMMIT;`);
      // 2026-10-11 移除 category 列——课件名不绑分类（产品不止题图→GGB 一条链路）。
      // 旧库若已有该列，尽力删掉；旧版 SQLite 不支持 DROP COLUMN 就留着，它是惰性的。
      try { this.db.exec('ALTER TABLE coursewares DROP COLUMN category'); } catch { /* 旧库/旧 SQLite：列惰性，可留 */ }
    } catch (e) { this.db.close(); throw e; }
  }
  private safeDirectory(relative: string): string {
    const full = path.join(this.root, relative);
    fs.mkdirSync(full, { recursive: true, mode: 0o700 });
    if (fs.realpathSync(full) !== full || fs.lstatSync(full).isSymbolicLink())
      throw new CoursewareError(400, '课件资源目录不允许符号链接');
    return full;
  }
  private file(relative: string): string {
    const full = path.resolve(this.root, relative);
    if (!full.startsWith(this.root + path.sep)) throw new CoursewareError(400, '资源路径不合法');
    this.safeDirectory(path.relative(this.root, path.dirname(full)) || '.');
    if (fs.existsSync(full) && fs.lstatSync(full).isSymbolicLink()) throw new CoursewareError(400, '资源不允许符号链接');
    return full;
  }
  private put(relative: string, content: Buffer): void {
    const target = this.file(relative);
    if (fs.existsSync(target)) {
      if (hash(fs.readFileSync(target)) !== hash(content)) throw new CoursewareError(500, '资源校验失败，原文件已保留');
      return;
    }
    const temp = this.file(relative + '.' + randomUUID() + '.tmp');
    fs.writeFileSync(temp, content, { flag: 'wx', mode: 0o600, flush: true });
    fs.renameSync(temp, target);
    // Directory fsync is unsupported on Windows; keep previous revisions as recovery points.
    if (process.platform !== 'win32') { const fd = fs.openSync(path.dirname(target), 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  }
  list(deleted = false): CoursewareSummary[] {
    return this.db.prepare(`SELECT * FROM coursewares WHERE deleted_at IS ${deleted ? 'NOT ' : ''}NULL ORDER BY updated_at DESC`).all() as unknown as CoursewareSummary[];
  }
  get(id: string, revision?: number) {
    validId(id);
    const row = this.db.prepare(`SELECT c.*, r.payload, r.snapshot FROM coursewares c JOIN revisions r
      ON r.id=c.id AND r.revision=COALESCE(?,c.revision) WHERE c.id=?`).get(revision ?? null, id) as unknown as Row | undefined;
    if (!row) throw new CoursewareError(404, '课件不存在');
    const { payload, snapshot, ...summary } = row;
    const ggbBase64 = snapshot ? this.readResource(`coursewares/${id}/${snapshot}.ggb`, snapshot).toString('base64') : undefined;
    return { ...summary, ...JSON.parse(payload), revision: revision ?? summary.revision, ggbBase64 };
  }
  private readResource(relative: string, expected: string): Buffer {
    const content = fs.readFileSync(this.file(relative));
    if (hash(content) !== expected) throw new CoursewareError(500, '课件资源损坏，请从上一版本或备份恢复');
    return content;
  }
  asset(key: string): { data: Buffer; mime: string } {
    const m = /^([a-f0-9]{64})\.(png|jpg|webp|gif)$/.exec(key);
    if (!m) throw new CoursewareError(400, '图片 ID 不合法');
    return { data: this.readResource(`assets/${key}`, m[1]), mime: `image/${m[2] === 'jpg' ? 'jpeg' : m[2]}` };
  }
  private messages(input: unknown[]): unknown[] {
    return input.map(raw => {
      if (!raw || typeof raw !== 'object') throw new CoursewareError(400, '消息记录不合法');
      const m = raw as Record<string, unknown>;
      if (!['user', 'assistant', 'system'].includes(String(m.role)) || typeof m.content !== 'string')
        throw new CoursewareError(400, '消息记录不合法');
      const attachments = Array.isArray(m.attachments) ? m.attachments.map(rawAtt => {
        const a = rawAtt as Record<string, unknown>;
        let url = typeof a.url === 'string' ? a.url : '';
        const data = /^data:image\/(png|jpeg|webp|gif);base64,(.+)$/.exec(url);
        if (data) {
          const content = bytes(data[2], 10 * 1024 * 1024);
          const ext = data[1] === 'jpeg' ? 'jpg' : data[1];
          const key = `${hash(content)}.${ext}`;
          this.put(`assets/${key}`, content);
          url = `/api/coursewares/assets/${key}`;
        } else if (url && !/^\/api\/coursewares\/assets\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(url)) {
          // Legacy blob/external URLs cannot be reliably restored. Mark explicitly instead of lying.
          url = '';
        } else if (url) this.asset(url.split('/').pop()!);
        return { id: a.id, name: a.name, contentType: a.contentType, url, unavailable: !url };
      }) : undefined;
      return { id: m.id, role: m.role, content: m.content, createdAt: m.createdAt, meta: m.meta, attachments };
    });
  }
  save(input: CoursewareInput): CoursewareSummary {
    validId(input.id);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || typeof input.title !== 'string' || !input.title.trim()
      || !Array.isArray(input.commands) || input.commands.some(c => typeof c !== 'string') || !Array.isArray(input.messages))
      throw new CoursewareError(400, '课件数据不合法');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT * FROM coursewares WHERE id=?').get(input.id) as unknown as CoursewareSummary | undefined;
      if ((old?.revision ?? 0) !== input.expectedRevision || old?.deleted_at) throw new CoursewareError(409, '课件已在其他窗口修改或删除，请重新打开；本窗口内容尚未保存');
      const now = new Date().toISOString();
      let snapshot: string | null = old ? (this.db.prepare('SELECT snapshot FROM revisions WHERE id=? AND revision=?').get(old.id, old.revision)?.snapshot as string | null) : null;
      if (input.ggbBase64 !== undefined) {
        const content = bytes(input.ggbBase64, 32 * 1024 * 1024);
        try { validateGgbSnapshot(content); } catch { throw new CoursewareError(400, '画板快照不是完整、有效的 GGB ZIP 文件'); }
        snapshot = hash(content);
        this.put(`coursewares/${input.id}/${snapshot}.ggb`, content);
      }
      const payload = JSON.stringify({ commands: input.commands, messages: this.messages(input.messages), view: input.view,
        runtimeId: input.runtimeId, sessionId: input.sessionId });
      const created = old?.created_at ?? (input.created_at && Number.isFinite(Date.parse(input.created_at)) ? input.created_at : now);
      const revision = input.expectedRevision + 1;
      this.db.prepare(`INSERT INTO coursewares (id, title, created_at, updated_at, revision, deleted_at)
        VALUES (?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,updated_at=excluded.updated_at,revision=excluded.revision`).run(
          input.id, input.title.slice(0, 200), created, now, revision);
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?)').run(input.id, revision, payload, snapshot, now);
      this.db.exec('COMMIT');
      return { id: input.id, title: input.title.slice(0, 200), created_at: created, updated_at: now, revision, deleted_at: null };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  rename(id: string, title: string, expectedRevision: number) {
    const record = this.get(id);
    return this.save({ ...record, title, expectedRevision });
  }
  remove(ids: string[]): void {
    ids.forEach(validId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of ids) this.changeDeletion(id, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  private changeDeletion(id: string, deletedAt: string | null): void {
    const old = this.db.prepare('SELECT * FROM coursewares WHERE id=?').get(id) as unknown as CoursewareSummary | undefined;
    if (!old) throw new CoursewareError(404, '课件不存在');
    const revision = old.revision + 1;
    this.db.prepare(`INSERT INTO revisions SELECT id,?,payload,snapshot,? FROM revisions WHERE id=? AND revision=?`).run(revision, new Date().toISOString(), id, old.revision);
    this.db.prepare('UPDATE coursewares SET deleted_at=?,revision=? WHERE id=?').run(deletedAt, revision, id);
  }
  restore(id: string): void {
    validId(id); this.db.exec('BEGIN IMMEDIATE');
    try { this.changeDeletion(id, null); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  versions(id: string) { validId(id); return this.db.prepare('SELECT revision,saved_at FROM revisions WHERE id=? ORDER BY revision DESC').all(id); }
  import(record: CoursewareInput): CoursewareSummary {
    validId(record.id);
    const old = this.db.prepare('SELECT * FROM coursewares WHERE id=?').get(record.id);
    return old ? old as unknown as CoursewareSummary : this.save({ ...record, expectedRevision: 0 });
  }
  async createBackup(): Promise<string> {
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
    const relative = `backups/${name}`;
    this.safeDirectory(relative);
    await backup(this.db, this.file(`${relative}/library.sqlite`));
    const copy = new DatabaseSync(this.file(`${relative}/library.sqlite`), { readOnly: true });
    try {
      const resources = new Set<string>();
      for (const row of copy.prepare('SELECT id,snapshot,payload FROM revisions').all()) {
        if (typeof row.snapshot === 'string' && HASH.test(row.snapshot)) resources.add(`coursewares/${row.id}/${row.snapshot}.ggb`);
        for (const m of JSON.parse(String(row.payload)).messages ?? []) for (const a of m.attachments ?? [])
          if (a.url?.startsWith('/api/coursewares/assets/')) resources.add(`assets/${a.url.split('/').pop()}`);
      }
      for (const resource of resources) {
        const expected = path.basename(resource).split('.')[0];
        this.put(`${relative}/${resource}`, this.readResource(resource, expected));
      }
      this.put(`${relative}/complete.json`, Buffer.from(JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), resources: resources.size })));
    } finally { copy.close(); }
    return name;
  }
  close(): void { this.db.close(); }
}
