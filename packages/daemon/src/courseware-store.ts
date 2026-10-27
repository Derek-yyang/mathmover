import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dataDirectory } from './data-directory.ts';
import { validateGgbSnapshot } from './ggb-snapshot.ts';
import { CoursewareError, type CoursewareSummary, type CoursewareProject } from '@mathmover/ggb-core';
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
 * Explicit permanent deletion removes revisions and queues unreferenced resources
 * for retryable cleanup; normal saves never prune history. */
export class CoursewareStore {
  readonly root: string;
  readonly db: import('node:sqlite').DatabaseSync;
  private backupsInProgress = 0;
  constructor(root = dataDirectory()) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = fs.realpathSync(root);
    for (const dir of ['coursewares', 'assets', 'backups']) this.safeDirectory(dir);
    const dbPath = this.file('library.sqlite');
    this.db = new DatabaseSync(dbPath);
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const check = this.db.prepare('PRAGMA quick_check').get();
      if (Object.values(check ?? {})[0] !== 'ok') throw new Error('课件数据库校验失败，原文件未被重置');
      const version = Number(Object.values(this.db.prepare('PRAGMA user_version').get() ?? {})[0]);
      if (version > 3) throw new Error('课件库由较新版本创建，请升级程序');
      if (!version) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE coursewares (id TEXT PRIMARY KEY, title TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL, deleted_at TEXT);
        CREATE TABLE revisions (id TEXT NOT NULL REFERENCES coursewares(id), revision INTEGER NOT NULL,
          payload TEXT NOT NULL, snapshot TEXT, saved_at TEXT NOT NULL, PRIMARY KEY(id, revision));
        CREATE INDEX recent_coursewares ON coursewares(updated_at DESC);
        PRAGMA user_version=1; COMMIT;`);
      if (version < 2) this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE coursewares ADD COLUMN archived_at TEXT;
        UPDATE coursewares SET archived_at=deleted_at WHERE deleted_at IS NOT NULL;
        ALTER TABLE coursewares DROP COLUMN deleted_at;
        CREATE TABLE deleted_courseware_ids (id TEXT PRIMARY KEY);
        CREATE TABLE pending_resource_deletions (path TEXT PRIMARY KEY);
        PRAGMA user_version=2; COMMIT;`);
      if (version < 3) this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE courseware_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL,
          created_at TEXT NOT NULL, revision INTEGER NOT NULL);
        ALTER TABLE coursewares ADD COLUMN pinned_at TEXT;
        ALTER TABLE coursewares ADD COLUMN project_id TEXT REFERENCES courseware_projects(id) ON DELETE SET NULL;
        CREATE INDEX courseware_project ON coursewares(project_id);
        PRAGMA user_version=3; COMMIT;`);
      // 2026-10-11 移除 category 列——课件名不绑分类（产品不止题图→GGB 一条链路）。
      // 旧库若已有该列，尽力删掉；旧版 SQLite 不支持 DROP COLUMN 就留着，它是惰性的。
      try { this.db.exec('ALTER TABLE coursewares DROP COLUMN category'); } catch { /* 旧库/旧 SQLite：列惰性，可留 */ }
    } catch (e) { this.db.close(); throw e; }
    this.cleanupDeletedResources();
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
  list(archived = false): CoursewareSummary[] {
    return this.db.prepare(`SELECT * FROM coursewares WHERE archived_at IS ${archived ? 'NOT ' : ''}NULL ORDER BY updated_at DESC`).all() as unknown as CoursewareSummary[];
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
    if (!fs.existsSync(this.file(`assets/${key}`))) throw new CoursewareError(404, '图片资源不存在');
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
      if ((old?.revision ?? 0) !== input.expectedRevision || this.db.prepare('SELECT id FROM deleted_courseware_ids WHERE id=?').get(input.id)) throw new CoursewareError(409, '课件已在其他窗口修改或删除，请重新打开；本窗口内容尚未保存');
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
      this.db.prepare(`INSERT INTO coursewares (id, title, created_at, updated_at, revision, archived_at)
        VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        title=excluded.title,updated_at=excluded.updated_at,revision=excluded.revision`).run(
          input.id, input.title.slice(0, 200), created, now, revision, old?.archived_at ?? null);
      this.db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?)').run(input.id, revision, payload, snapshot, now);
      this.db.exec('COMMIT');
      return this.summary(input.id);
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  rename(id: string, title: string, expectedRevision: number) {
    const record = this.get(id);
    return this.save({ ...record, title, expectedRevision });
  }
  private summary(id: string): CoursewareSummary {
    const row = this.db.prepare('SELECT * FROM coursewares WHERE id=?').get(id) as unknown as CoursewareSummary | undefined;
    if (!row) throw new CoursewareError(404, '课件不存在');
    return row;
  }
  projects(): CoursewareProject[] {
    return this.db.prepare('SELECT * FROM courseware_projects ORDER BY created_at,id').all() as unknown as CoursewareProject[];
  }
  private projectName(name: unknown): string {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
      throw new CoursewareError(400, '项目名称须为 1–80 个字符');
    return name.trim();
  }
  createProject(name: unknown, coursewareId?: string): CoursewareProject {
    const project = { id: randomUUID(), name: this.projectName(name), created_at: new Date().toISOString(), revision: 1 };
    if (coursewareId !== undefined) validId(coursewareId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (coursewareId !== undefined) this.summary(coursewareId);
      this.db.prepare('INSERT INTO courseware_projects VALUES (?,?,?,?)').run(project.id, project.name, project.created_at, project.revision);
      if (coursewareId !== undefined) this.db.prepare('UPDATE coursewares SET project_id=? WHERE id=?').run(project.id, coursewareId);
      this.db.exec('COMMIT');
      return project;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  updateProject(id: string, action: 'rename' | 'delete', expectedRevision: number, name?: unknown): CoursewareProject | null {
    validId(id);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new CoursewareError(400, '项目版本不合法');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT * FROM courseware_projects WHERE id=?').get(id) as unknown as CoursewareProject | undefined;
      if (!old) throw new CoursewareError(404, '项目不存在');
      if (old.revision !== expectedRevision) throw new CoursewareError(409, '项目已在其他窗口修改，请刷新后重试');
      const next = action === 'rename' ? { ...old, name: this.projectName(name), revision: old.revision + 1 } : null;
      if (next) this.db.prepare('UPDATE courseware_projects SET name=?,revision=? WHERE id=?').run(next.name, next.revision, id);
      else this.db.prepare('DELETE FROM courseware_projects WHERE id=?').run(id);
      this.db.exec('COMMIT');
      return next;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  organize(id: string, patch: { pinned?: boolean; projectId?: string | null }): CoursewareSummary {
    validId(id);
    const keys = Object.keys(patch);
    if (!keys.length || keys.some(key => !['pinned', 'projectId'].includes(key))
      || ('pinned' in patch && typeof patch.pinned !== 'boolean')) throw new CoursewareError(400, '课件整理参数不合法');
    if ('projectId' in patch && patch.projectId !== null) validId(patch.projectId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.summary(id);
      if (patch.projectId && !this.db.prepare('SELECT id FROM courseware_projects WHERE id=?').get(patch.projectId))
        throw new CoursewareError(404, '项目不存在，请刷新后重试');
      // Content saves never overwrite these columns or bump their revision.
      // A late autosave and a sidebar operation can safely complete in either order.
      this.db.prepare('UPDATE coursewares SET pinned_at=?,project_id=? WHERE id=?').run(
        patch.pinned === undefined ? old.pinned_at ?? null : patch.pinned ? old.pinned_at ?? new Date().toISOString() : null,
        'projectId' in patch ? patch.projectId! : old.project_id ?? null, id);
      const result = this.summary(id);
      this.db.exec('COMMIT');
      return result;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  remove(ids: string[]): void {
    if (!ids.length) throw new CoursewareError(400, '缺少课件 ID');
    ids.forEach(validId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of new Set(ids)) {
        if (!this.db.prepare('SELECT id FROM coursewares WHERE id=?').get(id)) throw new CoursewareError(404, '课件不存在');
        const resources = new Set<string>();
        for (const row of this.db.prepare('SELECT snapshot,payload FROM revisions WHERE id=?').all(id)) {
          if (typeof row.snapshot === 'string' && HASH.test(row.snapshot)) resources.add(`coursewares/${id}/${row.snapshot}.ggb`);
          for (const key of this.assetKeys(String(row.payload))) resources.add(`assets/${key}`);
        }
        // Include resource files left by an interrupted save of this courseware.
        const directory = this.file(`coursewares/${id}`);
        if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory)) {
          if (/^[a-f0-9]{64}\.ggb(?:\.[a-f0-9-]+\.tmp)?$/.test(name)) resources.add(`coursewares/${id}/${name}`);
        }
        for (const resource of resources) this.db.prepare('INSERT OR IGNORE INTO pending_resource_deletions VALUES (?)').run(resource);
        this.db.prepare('DELETE FROM revisions WHERE id=?').run(id);
        this.db.prepare('DELETE FROM coursewares WHERE id=?').run(id);
        // Only the ID is retained, so a late browser save cannot recreate a deleted courseware.
        this.db.prepare('INSERT INTO deleted_courseware_ids VALUES (?)').run(id);
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    this.cleanupDeletedResources();
  }
  setArchived(id: string, archived: boolean, expectedRevision: number): CoursewareSummary {
    validId(id);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new CoursewareError(400, '课件版本不合法');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT * FROM coursewares WHERE id=?').get(id) as unknown as CoursewareSummary | undefined;
      if (!old) throw new CoursewareError(404, '课件不存在');
      if (old.revision !== expectedRevision) throw new CoursewareError(409, '课件已在其他窗口修改，请刷新后重试');
      if (!!old.archived_at === archived) { this.db.exec('COMMIT'); return old; }
      const now = new Date().toISOString();
      const revision = old.revision + 1;
      const archivedAt = archived ? now : null;
      this.db.prepare('INSERT INTO revisions SELECT id,?,payload,snapshot,? FROM revisions WHERE id=? AND revision=?').run(revision, now, id, old.revision);
      this.db.prepare('UPDATE coursewares SET archived_at=?,revision=? WHERE id=?').run(archivedAt, revision, id);
      this.db.exec('COMMIT');
      return { ...old, archived_at: archivedAt, revision };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  private assetKeys(payload: string): Set<string> {
    const keys = new Set<string>();
    for (const message of JSON.parse(payload).messages ?? []) for (const attachment of message.attachments ?? []) {
      const match = /^\/api\/coursewares\/assets\/([a-f0-9]{64}\.(?:png|jpg|webp|gif))$/.exec(attachment.url ?? '');
      if (match) keys.add(match[1]);
    }
    return keys;
  }
  private cleanupDeletedResources(): void {
    // A backup may already reference these files in its database snapshot.
    // Keep them until it finishes copying, then drain the durable cleanup queue.
    if (this.backupsInProgress) return;
    // Resource cleanup is retried on startup and the next deletion. Hold the DB
    // writer lock while checking references/unlinking to protect shared images.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const pending = this.db.prepare('SELECT path FROM pending_resource_deletions').all();
      const referenced = new Set<string>();
      if (pending.some(row => String(row.path).startsWith('assets/'))) {
        for (const row of this.db.prepare('SELECT payload FROM revisions').all()) for (const key of this.assetKeys(String(row.payload))) referenced.add(`assets/${key}`);
      }
      for (const row of pending) {
        const relative = String(row.path);
        if (referenced.has(relative)) { this.db.prepare('DELETE FROM pending_resource_deletions WHERE path=?').run(relative); continue; }
        if (!/^(?:assets\/[a-f0-9]{64}\.(?:png|jpg|webp|gif)|coursewares\/[a-zA-Z0-9_-]{1,100}\/[a-f0-9]{64}\.ggb(?:\.[a-f0-9-]+\.tmp)?)$/.test(relative)) throw new Error('删除资源路径不合法');
        try {
          const target = this.file(relative);
          if (fs.existsSync(target)) fs.unlinkSync(target);
          this.db.prepare('DELETE FROM pending_resource_deletions WHERE path=?').run(relative);
          if (relative.startsWith('coursewares/')) {
            const directory = path.dirname(target);
            if (!fs.readdirSync(directory).length) fs.rmdirSync(directory);
          }
        } catch (error) { console.error('[courseware-resource-cleanup]', error); }
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); console.error('[courseware-resource-cleanup]', error); }
  }
  versions(id: string) {
    validId(id);
    if (!this.db.prepare('SELECT id FROM coursewares WHERE id=?').get(id)) throw new CoursewareError(404, '课件不存在');
    return this.db.prepare('SELECT revision,saved_at FROM revisions WHERE id=? ORDER BY revision DESC').all(id);
  }
  async createBackup(): Promise<string> {
    this.backupsInProgress++;
    try {
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
      const relative = `backups/${name}`;
      this.safeDirectory(relative);
      // 备份源必须是**独立连接**。node:sqlite 的 backup() 是异步增量拷贝，若拷贝期间
      // 又有语句落在**同一个连接**上（备份跑着，一次 remove/save 进来——线上就是这么用的），
      // 它会抛一个没有 stack 的 `Error: not an error`：实测同一连接 20 次挂 7 次，
      // 换成独立连接后 20/20 通过。SQLite 的备份 API 本就为「活库备份」设计，
      // 源库被并发写时它会从头重来；但要让它看得见这件事，源得是它自己的连接。
      const source = new DatabaseSync(this.file('library.sqlite'));
      try {
        source.exec('PRAGMA busy_timeout=5000');
        await backup(source, this.file(`${relative}/library.sqlite`));
      } finally { source.close(); }
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
        this.put(`${relative}/complete.json`, Buffer.from(JSON.stringify({ schemaVersion: 2, createdAt: new Date().toISOString(), resources: resources.size })));
      } finally { copy.close(); }
      return name;
    } finally {
      this.backupsInProgress--;
      this.cleanupDeletedResources();
    }
  }
  close(): void { this.db.close(); }
}
