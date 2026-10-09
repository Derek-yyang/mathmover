import { afterEach, describe, expect, it } from 'vitest';
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
  it('uses user data instead of installation or cwd', () => {
    expect(dataDirectory({ LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' }, 'win32')).toBe(path.join('C:\\Users\\test\\AppData\\Local', 'MathMover'));
    expect(dataDirectory({ MATHMOVER_DATA_DIR: roots[0] || os.tmpdir() })).toBe(path.resolve(roots[0] || os.tmpdir()));
  });
  it('commits a durable snapshot and reopens without browser storage', () => {
    const s = make(); s.save(record()); const reopened = new CoursewareStore(s.root); stores.push(reopened);
    expect(reopened.get('course-1').ggbBase64).toBe(ggb);
    expect(reopened.get('course-1').messages[0].content).toBe('画点');
    expect(reopened.db.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
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
  it('imports once and does not overwrite existing local records', () => {
    const s = make(); s.import(record()); s.import(record({ title: '旧浏览器副本' }));
    expect(s.list()).toHaveLength(1); expect(s.get('course-1').title).toBe('函数');
  });
  it('soft deletes and restores; stale saves cannot resurrect deletion', () => {
    const s = make(); s.save(record()); s.remove(['course-1']);
    expect(s.list()).toHaveLength(0); expect(s.list(true)).toHaveLength(1);
    expect(() => s.save(record({ expectedRevision: 1 }))).toThrow();
    s.restore('course-1'); expect(s.list()[0].revision).toBe(3); expect(s.get('course-1').ggbBase64).toBe(ggb);
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
