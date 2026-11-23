import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../packages/daemon/src/mcp-server.ts';
import { GgbTools, DEFAULT_TOOLS_CONFIG } from '../../packages/daemon/src/tools.ts';
import { CanvasBridge } from './bridge.ts';

export type SessionInfo = { id: string; title: string; createdAt: string; accessToken?: string };

function createAccessToken() {
  return randomBytes(32).toString('hex');
}

function isAccessToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export class CanvasSession {
  readonly info: SessionInfo;
  readonly token: string;
  readonly bridge = new CanvasBridge();
  readonly workfile: string;
  readonly tools: GgbTools;
  readonly client = new Client({ name: 'mathmover-mcp-session', version: '0.1.0' });
  private queue: Promise<unknown> = Promise.resolve();
  deleted = false;
  private coreServer: ReturnType<typeof createMcpServer>;

  constructor(info: SessionInfo, readonly directory: string, assets: string) {
    this.info = { ...info, accessToken: isAccessToken(info.accessToken) ? info.accessToken : createAccessToken() };
    this.token = this.info.accessToken!;
    this.workfile = path.join(directory, 'construction.ggb.txt');
    this.tools = new GgbTools(this.bridge, { ...DEFAULT_TOOLS_CONFIG, workdir: directory });
    this.coreServer = createMcpServer(this.tools, { name: 'mathmover', version: '0.1.0' }, { rootDir: assets });
  }

  async start() {
    const [client, server] = InMemoryTransport.createLinkedPair();
    await this.coreServer.connect(server);
    await this.client.connect(client);
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => {
      if (this.deleted) throw new Error('课件已删除，请切换到其他课件。');
      return operation();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  async close() {
    this.bridge.close();
    await this.client.close();
    await this.coreServer.close();
  }
}

export class SessionStore {
  readonly loaded = new Map<string, CanvasSession>();
  readonly managementToken = createAccessToken();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string, private assets: string) {}

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  open(id?: string, title = '未命名课件'): Promise<CanvasSession> {
    return this.exclusive(async () => {
      const key = id ?? randomUUID();
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key)) throw new Error('无效的画板会话 ID');
      const existing = this.loaded.get(key);
      if (existing) return existing;
      return await this.load(key, id !== undefined, title);
    });
  }

  rename(id: string, title: string) {
    return this.exclusive(async () => {
      const clean = title.trim();
      if (!clean || clean.length > 100) throw new Error('课件名称需为 1–100 个字符');
      const session = this.loaded.get(id) ?? await this.loadExisting(id);
      await session.run(async () => {
        const info = { ...session.info, title: clean };
        const target = path.join(session.directory, 'session.json');
        await fs.writeFile(`${target}.tmp`, JSON.stringify(info), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(`${target}.tmp`, target);
        session.info.title = clean;
      });
      return { id, title: clean, createdAt: session.info.createdAt };
    });
  }

  remove(id: string) {
    return this.exclusive(async () => {
      const session = this.loaded.get(id) ?? await this.loadExisting(id);
      await session.run(async () => {
        const trash = path.join(this.directory, 'trash');
        const target = path.resolve(trash, `${id}-${Date.now()}`);
        if (!target.startsWith(path.resolve(this.directory) + path.sep) || !path.resolve(session.directory).startsWith(path.resolve(this.directory, 'sessions') + path.sep)) throw new Error('无效的课件存储路径');
        await fs.mkdir(trash, { recursive: true });
        await fs.rename(session.directory, target);
        session.deleted = true;
        this.loaded.delete(id);
      });
      await session.close();
    });
  }

  private loadExisting(id: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) throw new Error('无效的画板会话 ID');
    return this.load(id, true, '');
  }

  private async load(id: string, resume: boolean, title: string) {
    const directory = path.join(this.directory, 'sessions', id);
    let info: SessionInfo;
    if (resume) {
      const sessionFile = path.join(directory, 'session.json');
      info = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
      if (info.id !== id || typeof info.title !== 'string') throw new Error('会话记录损坏');
      if (!isAccessToken(info.accessToken)) {
        info.accessToken = createAccessToken();
        await fs.writeFile(sessionFile, JSON.stringify(info), { encoding: 'utf8', mode: 0o600 });
      }
    } else {
      info = {
        id,
        title: title.trim().slice(0, 100) || '未命名课件',
        createdAt: new Date().toISOString(),
        accessToken: createAccessToken(),
      };
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'session.json'), JSON.stringify(info), { encoding: 'utf8', mode: 0o600 });
      await fs.writeFile(path.join(directory, 'construction.ggb.txt'), '', { flag: 'wx' });
    }
    const session = new CanvasSession(info, directory, this.assets);
    await session.start();
    this.loaded.set(id, session);
    return session;
  }

  async list(): Promise<SessionInfo[]> {
    const root = path.join(this.directory, 'sessions');
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const result: SessionInfo[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
      try {
        const info = JSON.parse(await fs.readFile(path.join(root, entry.name, 'session.json'), 'utf8'));
        if (info.id === entry.name && typeof info.title === 'string') {
          result.push({ id: info.id, title: info.title, createdAt: info.createdAt });
        }
      } catch { /* Ignore incomplete directories, never delete user work. */ }
    }
    return result.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async close() {
    await Promise.all([...this.loaded.values()].map(session => session.close()));
  }
}
