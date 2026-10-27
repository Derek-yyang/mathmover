import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { CoursewareStore, type CoursewareInput } from '../src/courseware-store.ts';
import { dataDirectory, libraryToken } from '../src/data-directory.ts';
import { ggbFixture } from './ggb-fixture.ts';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const roots: string[] = []; const stores: CoursewareStore[] = [];
const ggb = ggbFixture();
function make() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mathmover-library-test-')); roots.push(root); const s = new CoursewareStore(root); stores.push(s); return s; }
const record = (changes: Partial<CoursewareInput> = {}): CoursewareInput => ({ id: 'course-1', expectedRevision: 0, title: '函数', commands: ['A=(0,0)'], messages: [{ id: 'u1', role: 'user', content: '画点', createdAt: 1 }], ggbBase64: ggb, ...changes });
afterEach(() => { for (const s of stores.splice(0)) { try { s.close(); } catch {} } for (const root of roots.splice(0)) { if (!root.startsWith(path.join(os.tmpdir(), 'mathmover-library-test-'))) throw new Error('Unsafe cleanup'); fs.rmSync(root, { recursive: true, force: true }); } });
describe('local courseware library', () => {
  it('keeps organization through late autosaves, renames, archives, restart and backup', async () => {
    const s = make(); const initial = s.save(record());
    const project = s.createProject('  圆锥曲线  ');
    const organized = s.organize(initial.id, { pinned: true, projectId: project.id });
    expect(organized.revision).toBe(initial.revision);
    expect(organized.updated_at).toBe(initial.updated_at);
    // This snapshot was captured before pinning/moving; content saves must not undo either.
    const saved = s.save(record({ expectedRevision: initial.revision }));
    expect(saved.project_id).toBe(project.id); expect(saved.pinned_at).toBeTruthy();
    const renamed = s.rename(saved.id, '椭圆', saved.revision);
    const archived = s.setArchived(saved.id, true, renamed.revision);
    expect(archived.project_id).toBe(project.id);
    expect(s.setArchived(saved.id, false, archived.revision).pinned_at).toBe(organized.pinned_at);
    const name = await s.createBackup();
    const restored = new CoursewareStore(path.join(s.root, 'backups', name)); stores.push(restored);
    expect(restored.projects()).toEqual([{ ...project, name: '圆锥曲线' }]);
    expect(restored.list()[0].project_id).toBe(project.id);
    expect(restored.get(saved.id).ggbBase64).toBe(ggb);
    const reopened = new CoursewareStore(s.root); stores.push(reopened);
    expect(reopened.list()[0].pinned_at).toBe(organized.pinned_at);
    reopened.organize(saved.id, { pinned: false });
    expect(reopened.get(saved.id).project_id).toBe(project.id);
    const changed = reopened.updateProject(project.id, 'rename', project.revision, '解析几何')!;
    expect(() => reopened.updateProject(project.id, 'delete', project.revision)).toThrow('其他窗口');
    reopened.updateProject(project.id, 'delete', changed.revision);
    expect(reopened.get(saved.id).project_id).toBeNull();
    expect(reopened.get(saved.id).commands).toEqual(['A=(0,0)']);
  });
  it('validates organization and creates a project plus move atomically', () => {
    const s = make(); s.save(record());
    expect(() => s.createProject(' ')).toThrow('项目名称');
    expect(() => s.createProject('a'.repeat(81))).toThrow('项目名称');
    expect(() => s.createProject('不存在的课件', 'missing')).toThrow('不存在');
    expect(s.projects()).toHaveLength(0);
    const project = s.createProject('立体几何', 'course-1');
    expect(s.get('course-1').project_id).toBe(project.id);
    expect(() => s.organize('course-1', { projectId: 'missing', pinned: true })).toThrow('项目不存在');
    expect(s.get('course-1').pinned_at).toBeNull();
    expect(() => s.organize('missing', { pinned: true })).toThrow('课件不存在');
    expect(() => s.organize('course-1', { pinned: 'true' as unknown as boolean })).toThrow('参数');
    expect(() => s.organize('course-1', {})).toThrow('参数');
    s.organize('course-1', { pinned: true, projectId: null });
    expect(s.get('course-1').project_id).toBeNull();
    s.remove(['course-1']);
    expect(s.projects()).toHaveLength(1);
    expect(() => s.organize('course-1', { pinned: true })).toThrow('不存在');
  });
  it('migrates a schema 2 library without changing content or revisions', () => {
    const s = make(); s.save(record());
    s.db.exec(`DROP INDEX courseware_project; ALTER TABLE coursewares DROP COLUMN project_id;
      ALTER TABLE coursewares DROP COLUMN pinned_at; DROP TABLE courseware_projects; PRAGMA user_version=2;`);
    const migrated = new CoursewareStore(s.root); stores.push(migrated);
    expect(migrated.projects()).toEqual([]);
    expect(migrated.get('course-1')).toMatchObject({ revision: 1, pinned_at: null, project_id: null, ggbBase64: ggb });
  });
  it('uses user data instead of installation or cwd', () => {
    expect(dataDirectory({ LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' }, 'win32')).toBe(path.join('C:\\Users\\test\\AppData\\Local', 'MathMover'));
    expect(dataDirectory({ MATHMOVER_DATA_DIR: roots[0] || os.tmpdir() })).toBe(path.resolve(roots[0] || os.tmpdir()));
  });
  it('commits a durable snapshot and reopens without browser storage', () => {
    const s = make(); s.save(record()); const reopened = new CoursewareStore(s.root); stores.push(reopened);
    expect(reopened.get('course-1').ggbBase64).toBe(ggb);
    expect(reopened.get('course-1').messages[0].content).toBe('画点');
    expect(reopened.db.prepare('PRAGMA user_version').get()?.user_version).toBe(3);
  });
  it('rejects stale windows without overwriting history', () => {
    const s = make(); s.save(record()); s.save(record({ expectedRevision: 1, title: '新题' }));
    expect(() => s.save(record({ expectedRevision: 1, title: '迟到写入' }))).toThrow('其他窗口');
    expect(s.get('course-1').title).toBe('新题'); expect(s.versions('course-1')).toHaveLength(2);
  });
  it('keeps the previous revision on resource write failure', () => {
    const s = make(); s.save(record()); fs.mkdirSync(path.join(s.root, 'assets', 'blocked'));
    const resourceDir = path.join(s.root, 'coursewares', 'course-1');
    fs.renameSync(resourceDir, resourceDir + '-original'); fs.writeFileSync(resourceDir, 'not a directory');
    expect(() => s.save(record({ expectedRevision: 1, ggbBase64: ggbFixture('different') }))).toThrow();
    expect(s.list()[0].revision).toBe(1);
    fs.unlinkSync(resourceDir); fs.renameSync(resourceDir + '-original', resourceDir);
    expect(s.get('course-1').ggbBase64).toBe(ggb);
  });
  it('writes original image resources and marks unrecoverable legacy blobs', () => {
    const s = make(); s.save(record({ messages: [{ role: 'user', content: '图片', attachments: [
      { url: 'data:image/png;base64,aW1hZ2U=', name: '题目.png' }, { url: 'blob:expired', name: '旧图.png' },
    ] }] }));
    const attachments = s.get('course-1').messages[0].attachments;
    expect(s.asset(attachments[0].url.split('/').pop()).data.toString()).toBe('image');
    expect(attachments[1].unavailable).toBe(true);
  });
  it('archives and unarchives without losing content; edits keep the archive state', () => {
    const s = make(); s.save(record());
    expect(s.setArchived('course-1', true, 1).revision).toBe(2);
    expect(s.list()).toHaveLength(0); expect(s.list(true)).toHaveLength(1);
    expect(s.get('course-1').ggbBase64).toBe(ggb);
    expect(() => s.save(record({ expectedRevision: 1 }))).toThrow('其他窗口');
    expect(() => s.setArchived('course-1', false, 1)).toThrow('其他窗口');
    s.save(record({ expectedRevision: 2, title: '归档后编辑' }));
    expect(s.list()).toHaveLength(0); expect(s.list(true)[0].title).toBe('归档后编辑');
    s.setArchived('course-1', false, 3);
    expect(s.list()[0].revision).toBe(4); expect(s.list(true)).toHaveLength(0);
    expect(s.get('course-1').messages[0].content).toBe('画点');
  });
  it('permanently deletes all revisions and snapshots and rejects late recreation', () => {
    const s = make(); s.save(record()); s.save(record({ expectedRevision: 1, ggbBase64: ggbFixture('second') }));
    s.setArchived('course-1', true, 2);
    s.remove(['course-1']);
    expect(s.list()).toHaveLength(0); expect(s.list(true)).toHaveLength(0);
    expect(() => s.get('course-1')).toThrow('不存在');
    expect(() => s.get('course-1', 1)).toThrow('不存在');
    expect(s.db.prepare('SELECT COUNT(*) n FROM revisions').get()?.n).toBe(0);
    expect(fs.existsSync(path.join(s.root, 'coursewares', 'course-1'))).toBe(false);
    expect(() => s.save(record({ expectedRevision: 3 }))).toThrow('其他窗口');
    expect(() => s.save(record())).toThrow('其他窗口');
    const reopened = new CoursewareStore(s.root); stores.push(reopened);
    expect(() => reopened.save(record())).toThrow('其他窗口');
  });
  it('keeps shared images referenced by archived or historical revisions', () => {
    const s = make();
    const messages = [{ role: 'user', content: '图片', attachments: [{ url: 'data:image/png;base64,aW1hZ2U=' }] }];
    s.save(record({ messages })); s.save(record({ id: 'course-2', messages }));
    const key = s.get('course-1').messages[0].attachments[0].url.split('/').pop();
    s.save(record({ id: 'course-2', expectedRevision: 1, messages: [] }));
    s.setArchived('course-2', true, 2);
    s.remove(['course-1']);
    expect(s.asset(key).data.toString()).toBe('image');
    s.remove(['course-2']);
    expect(() => s.asset(key)).toThrow('不存在');
    expect(fs.readdirSync(path.join(s.root, 'assets'))).toHaveLength(0);
  });
  it('rolls back a batch containing a missing ID without removing any files', () => {
    const s = make(); s.save(record());
    expect(() => s.remove(['course-1', 'missing'])).toThrow('不存在');
    expect(s.get('course-1').ggbBase64).toBe(ggb);
    expect(s.db.prepare('SELECT COUNT(*) n FROM pending_resource_deletions').get()?.n).toBe(0);
  });
  it('retries resource deletion after filesystem failure and restart', () => {
    const s = make(); s.save(record());
    const unlink = vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => { throw new Error('fixture disk busy'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { s.remove(['course-1']); } finally { unlink.mockRestore(); log.mockRestore(); }
    expect(() => s.get('course-1')).toThrow('不存在');
    expect(s.db.prepare('SELECT COUNT(*) n FROM pending_resource_deletions').get()?.n).toBe(1);
    const reopened = new CoursewareStore(s.root); stores.push(reopened);
    expect(reopened.db.prepare('SELECT COUNT(*) n FROM pending_resource_deletions').get()?.n).toBe(0);
    expect(fs.existsSync(path.join(s.root, 'coursewares', 'course-1'))).toBe(false);
  });
  it('migrates old recycle-bin records into archives without losing history', () => {
    const s = make(); s.save(record());
    const when = new Date().toISOString();
    s.db.exec(`ALTER TABLE coursewares ADD COLUMN deleted_at TEXT;
      DROP INDEX courseware_project;
      ALTER TABLE coursewares DROP COLUMN project_id;
      ALTER TABLE coursewares DROP COLUMN pinned_at;
      DROP TABLE courseware_projects;
      UPDATE coursewares SET deleted_at='${when}';
      ALTER TABLE coursewares DROP COLUMN archived_at;
      DROP TABLE deleted_courseware_ids; DROP TABLE pending_resource_deletions; PRAGMA user_version=1;`);
    const migrated = new CoursewareStore(s.root); stores.push(migrated);
    expect(migrated.list()).toHaveLength(0);
    expect(migrated.list(true)[0].archived_at).toBe(when);
    expect(migrated.get('course-1').ggbBase64).toBe(ggb);
    expect(migrated.get('course-1').messages[0].content).toBe('画点');
    expect(migrated.db.prepare('PRAGMA table_info(coursewares)').all().some(column => column.name === 'deleted_at')).toBe(false);
  });
  it('detects corrupt resources without destroying the database', () => {
    const s = make(); s.save(record()); const dir = path.join(s.root, 'coursewares', 'course-1');
    fs.writeFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'damaged');
    expect(() => s.get('course-1')).toThrow('资源损坏'); expect(s.list()).toHaveLength(1);
  });
  it('backs up the database and all referenced immutable resources', async () => {
    const s = make(); s.save(record()); const name = await s.createBackup();
    const dir = path.join(s.root, 'backups', name); expect(fs.existsSync(path.join(dir, 'complete.json'))).toBe(true);
    const copy = new DatabaseSync(path.join(dir, 'library.sqlite'), { readOnly: true });
    try { expect(copy.prepare('SELECT COUNT(*) n FROM coursewares').get()?.n).toBe(1); } finally { copy.close(); }
    const restored = new CoursewareStore(dir); stores.push(restored); expect(restored.get('course-1').ggbBase64).toBe(ggb);
  });
  it('finishes a concurrent backup before cleaning permanently deleted resources', async () => {
    // 跑 4 轮：node:sqlite 的备份与同连接写入交错只在约三分之一的跑次里翻车（见 createBackup 注释），
    // 单轮守不住这个回归。每轮独立 store，断言逐轮相同。
    for (let round = 0; round < 4; round++) {
      const s = make(); s.save(record());
      const pending = s.createBackup();
      s.remove(['course-1']);
      expect(() => s.get('course-1')).toThrow('不存在');
      expect(fs.existsSync(path.join(s.root, 'coursewares', 'course-1'))).toBe(true);
      const name = await pending;
      expect(fs.existsSync(path.join(s.root, 'backups', name, 'complete.json'))).toBe(true);
      expect(fs.existsSync(path.join(s.root, 'coursewares', 'course-1'))).toBe(false);
      const restored = new CoursewareStore(path.join(s.root, 'backups', name)); stores.push(restored);
      // SQLite may capture before or after the deletion; either snapshot is complete.
      if (restored.list().length) expect(restored.get('course-1').ggbBase64).toBe(ggb);
    }
  });
  it('rejects invalid paths, snapshots, and keeps the access token stable', () => {
    const s = make(); expect(() => s.save(record({ id: '../escape' }))).toThrow();
    expect(() => s.save(record({ ggbBase64: 'bm90LWdnYg==' }))).toThrow('GGB');
    expect(() => s.save(record({ ggbBase64: Buffer.from('PK\x03\x04truncated').toString('base64') }))).toThrow('GGB');
    expect(s.list()).toHaveLength(0); expect(libraryToken(s.root, true)).toBe(libraryToken(s.root, true));
  });
  it('rejects corrupted and future databases without resetting them', () => {
    const s = make();
    s.db.exec('PRAGMA user_version=999');
    expect(() => new CoursewareStore(s.root)).toThrow('较新版本');
    expect(s.db.prepare('PRAGMA user_version').get()?.user_version).toBe(999);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mathmover-library-test-')); roots.push(root);
    const original = Buffer.from('not a database'); fs.writeFileSync(path.join(root, 'library.sqlite'), original);
    expect(() => new CoursewareStore(root)).toThrow();
    expect(fs.readFileSync(path.join(root, 'library.sqlite'))).toEqual(original);
  });
  it('recovers the last committed revision after a writer is killed between file and DB commit', async () => {
    const s = make(); s.save(record());
    const moduleUrl = new URL('../src/courseware-store.ts', import.meta.url).href;
    const input = record({ expectedRevision: 1, title: '未提交版本', ggbBase64: ggbFixture('interrupted') });
    const source = `import fs from 'node:fs'; import {CoursewareStore} from ${JSON.stringify(moduleUrl)};
      const store=new CoursewareStore(${JSON.stringify(s.root)}); const rename=fs.renameSync;
      fs.renameSync=(...args)=>{ rename(...args); process.send('resource-written'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0); };
      store.save(${JSON.stringify(input)});`;
    const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', source], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let errors = ''; child.stderr?.on('data', chunk => { errors += String(chunk); });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Writer fixture timed out: '+errors)), 5000);
        child.once('message', () => { clearTimeout(timeout); resolve(); });
        child.once('error', e => { clearTimeout(timeout); reject(e); });
        child.once('exit', code => { clearTimeout(timeout); reject(new Error('Writer exited early '+code+': '+errors)); });
      });
      await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGKILL'); });
      expect(s.get('course-1').title).toBe('函数'); expect(s.list()[0].revision).toBe(1);
      expect(s.get('course-1').ggbBase64).toBe(ggb); expect(s.versions('course-1')).toHaveLength(1);
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
  });
});
