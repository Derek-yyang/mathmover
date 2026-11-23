import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SessionStore, type SessionInfo } from './sessions.ts';
import { serveCanvas, type CanvasControlHandlers } from './http.ts';

const SERVICE_PROTOCOL = 1;
const DRAWING_TOOL_NAMES = new Set(['ggb_get_state', 'ggb_apply', 'ggb_reset']);
const DAEMON_START_TIMEOUT_MS = 15_000;
const DAEMON_STOP_TIMEOUT_MS = 5_000;

export type CanvasInfo = {
  session_id: string;
  title: string;
  workfile: string;
  url: string;
  connected: boolean;
};

export interface CanvasService {
  readonly origin: string;
  open(sessionId?: string, title?: string): Promise<CanvasInfo>;
  list(): Promise<SessionInfo[]>;
  call(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

export type DaemonInfo = {
  protocol: number;
  version: string;
  pid: number;
  origin: string;
  controlToken: string;
};

type LocalCanvasServiceOptions = {
  dataDir: string;
  distDir: string;
  controlToken?: string;
  onShutdown?: () => void;
};

type PersistentServiceOptions = {
  dataDir: string;
  distDir: string;
  entryPoint?: string;
};

export function defaultDataDirectory() {
  const base = process.platform === 'win32'
    ? process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData/Local')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library/Application Support')
      : process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local/share');
  return path.join(base, 'MathMoverMCP');
}

export function daemonInfoPath(dataDir: string) {
  return path.join(path.resolve(dataDir), 'daemon.json');
}

function daemonLockPath(dataDir: string) {
  return path.join(path.resolve(dataDir), 'daemon-start.lock');
}

function daemonLogPath(dataDir: string) {
  return path.join(path.resolve(dataDir), 'daemon.log');
}

export async function packageVersion(distDir: string) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(distDir, '..', 'package.json'), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : '0.1.0';
  } catch {
    return '0.1.0';
  }
}

async function writeDaemonInfo(dataDir: string, info: DaemonInfo) {
  const target = daemonInfoPath(dataDir);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(info), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, target);
}

async function readDaemonInfo(dataDir: string): Promise<DaemonInfo | null> {
  try {
    const value = JSON.parse(await fs.readFile(daemonInfoPath(dataDir), 'utf8'));
    if (value.protocol !== SERVICE_PROTOCOL
      || typeof value.version !== 'string'
      || typeof value.pid !== 'number'
      || typeof value.origin !== 'string'
      || typeof value.controlToken !== 'string') return null;
    return value;
  } catch {
    return null;
  }
}

async function removeDaemonInfo(dataDir: string, controlToken?: string) {
  const current = await readDaemonInfo(dataDir);
  if (controlToken && current?.controlToken !== controlToken) return;
  await fs.rm(daemonInfoPath(dataDir), { force: true });
}

async function writeAppliedSnapshot(session: Awaited<ReturnType<SessionStore['open']>>) {
  const file = path.join(session.directory, 'applied.json');
  await fs.writeFile(`${file}.tmp`, JSON.stringify(await session.tools.readConstruction()), 'utf8');
  await fs.rename(`${file}.tmp`, file);
}

export class LocalCanvasService implements CanvasService {
  private server?: Awaited<ReturnType<typeof serveCanvas>>;

  private constructor(
    readonly store: SessionStore,
    readonly controlToken: string,
    private readonly publicDir: string,
    private readonly onShutdown?: () => void,
  ) {}

  static async create(options: LocalCanvasServiceOptions): Promise<LocalCanvasService> {
    const distDir = path.resolve(options.distDir);
    const store = new SessionStore(
      path.resolve(options.dataDir),
      path.join(distDir, 'assets'),
    );
    const service = new LocalCanvasService(
      store,
      options.controlToken ?? randomBytes(32).toString('hex'),
      path.join(distDir, 'public'),
      options.onShutdown,
    );
    const control: CanvasControlHandlers = {
      open: args => service.open(args.session_id, args.title),
      list: () => service.list(),
      call: args => service.call(args.name, args.arguments),
      shutdown: options.onShutdown,
    };
    service.server = await serveCanvas(store, service.publicDir, {
      controlToken: service.controlToken,
      control,
    });
    return service;
  }

  get origin() {
    if (!this.server) throw new Error('画板本地服务尚未启动');
    return this.server.origin;
  }

  async open(sessionId?: string, title?: string): Promise<CanvasInfo> {
    if (sessionId !== undefined && typeof sessionId !== 'string') throw new Error('session_id 必须为字符串');
    if (title !== undefined && typeof title !== 'string') throw new Error('title 必须为字符串');
    const session = await this.store.open(sessionId, title);
    return {
      session_id: session.info.id,
      title: session.info.title,
      workfile: session.workfile,
      url: `${this.origin}/canvas/${session.info.id}#token=${session.token}`,
      connected: session.bridge.connected,
    };
  }

  async list() {
    return await this.store.list();
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!DRAWING_TOOL_NAMES.has(name)) throw new Error(`未知画板工具：${name}`);
    if (typeof args.session_id !== 'string') {
      throw new Error('请携带当前画板的 session_id，先调用 mathmover_open_canvas 获取。');
    }
    const session = this.store.loaded.get(args.session_id);
    if (!session) throw new Error('会话尚未打开，请先用 mathmover_open_canvas 恢复对应 session_id。');
    const { session_id, ...coreArgs } = args;
    void session_id;
    return await session.run(async () => {
      const result = await session.client.callTool(
        { name, arguments: coreArgs },
        undefined,
        { timeout: 90_000 },
      );
      if (!result.isError && (name === 'ggb_apply' || name === 'ggb_reset')) {
        await writeAppliedSnapshot(session);
      }
      if (!('content' in result)) throw new Error('画板工具返回了无法识别的结果');
      return result as CallToolResult;
    });
  }

  async close() {
    await this.store.close();
    await this.server?.close();
    this.server = undefined;
  }
}

export class RemoteCanvasService implements CanvasService {
  readonly origin: string;

  constructor(private readonly info: DaemonInfo) {
    this.origin = info.origin;
  }

  get pid() {
    return this.info.pid;
  }

  private async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.origin}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.info.controlToken}`,
        Connection: 'close',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `本地画板服务请求失败：${response.status}`);
    return body as T;
  }

  async healthy() {
    try {
      const result = await this.request<{ ok: boolean; pid: number }>('/api/control/health');
      return result.ok === true && result.pid === this.info.pid;
    } catch {
      return false;
    }
  }

  async open(sessionId?: string, title?: string) {
    return await this.request<CanvasInfo>('/api/control/open', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, title }),
    });
  }

  async list() {
    return await this.request<SessionInfo[]>('/api/control/list');
  }

  async call(name: string, args: Record<string, unknown>) {
    return await this.request<CallToolResult>('/api/control/call', {
      method: 'POST',
      body: JSON.stringify({ name, arguments: args }),
    });
  }

  async shutdown() {
    return await this.request<{ stopping: boolean }>('/api/control/shutdown', { method: 'POST' });
  }

  async close() {
    // The daemon outlives each MCP host process by design.
  }
}

async function inspectService(info: DaemonInfo) {
  return await new RemoteCanvasService(info).healthy();
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitUntilStopped(service: RemoteCanvasService) {
  const deadline = Date.now() + DAEMON_STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!processExists(service.pid) && !(await service.healthy())) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function serviceReady(info: DaemonInfo | null, version: string) {
  return Boolean(info && info.version === version);
}

async function stopMismatchedOrStaleService(dataDir: string, info: DaemonInfo | null, version: string) {
  if (!info) {
    await fs.rm(daemonInfoPath(dataDir), { force: true });
    return;
  }
  const service = new RemoteCanvasService(info);
  if (!(await service.healthy())) {
    await removeDaemonInfo(dataDir, info.controlToken);
    return;
  }
  if (info.version === version) return;
  try {
    await service.shutdown();
    await waitUntilStopped(service);
  } catch {
    // A stale process still fails the next health check and will be replaced.
  }
}

async function waitForService(dataDir: string, version: string) {
  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const info = await readDaemonInfo(dataDir);
    if (info && serviceReady(info, version) && await inspectService(info)) {
      return new RemoteCanvasService(info);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`无法启动 MathMover 本地画板服务，请查看 ${daemonLogPath(dataDir)}`);
}

async function removeStaleLock(dataDir: string) {
  const lock = daemonLockPath(dataDir);
  try {
    const stat = await fs.stat(lock);
    if (Date.now() - stat.mtimeMs > DAEMON_START_TIMEOUT_MS * 2) await fs.rm(lock, { force: true });
  } catch {
    // Another process may have released the lock already.
  }
}

export async function ensurePersistentService(options: PersistentServiceOptions): Promise<RemoteCanvasService> {
  const dataDir = path.resolve(options.dataDir);
  const distDir = path.resolve(options.distDir);
  const version = await packageVersion(distDir);
  await fs.mkdir(dataDir, { recursive: true });

  const existing = await readDaemonInfo(dataDir);
  if (serviceReady(existing, version) && await inspectService(existing!)) {
    return new RemoteCanvasService(existing!);
  }
  await stopMismatchedOrStaleService(dataDir, existing, version);

  const lockPath = daemonLockPath(dataDir);
  let lock;
  try {
    lock = await fs.open(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    await removeStaleLock(dataDir);
    try {
      lock = await fs.open(lockPath, 'wx');
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code !== 'EEXIST') throw retryError;
      return await waitForService(dataDir, version);
    }
  }

  try {
    const current = await readDaemonInfo(dataDir);
    if (serviceReady(current, version) && await inspectService(current!)) {
      return new RemoteCanvasService(current!);
    }

    const entryPoint = path.resolve(options.entryPoint ?? process.argv[1]);
    const log = await fs.open(daemonLogPath(dataDir), 'a');
    try {
      const child = spawn(process.execPath, [entryPoint, '--daemon', '--data-dir', dataDir], {
        cwd: distDir,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log.fd, log.fd],
        env: { ...process.env, MATHMOVER_MCP_DAEMON_CHILD: '1' },
      });
      child.unref();
    } finally {
      await log.close();
    }
    return await waitForService(dataDir, version);
  } finally {
    await lock.close();
    await fs.rm(lockPath, { force: true });
  }
}

export async function shutdownPersistentService(dataDir: string) {
  const info = await readDaemonInfo(dataDir);
  if (!info) return false;
  const service = new RemoteCanvasService(info);
  if (!(await service.healthy())) {
    await removeDaemonInfo(dataDir, info.controlToken);
    return false;
  }
  await service.shutdown();
  await waitUntilStopped(service);
  await removeDaemonInfo(dataDir, info.controlToken);
  return true;
}

export async function runPersistentDaemon(options: { dataDir: string; distDir: string }) {
  const dataDir = path.resolve(options.dataDir);
  const distDir = path.resolve(options.distDir);
  const version = await packageVersion(distDir);
  const existing = await readDaemonInfo(dataDir);
  if (serviceReady(existing, version) && await inspectService(existing!)) return;

  const controlToken = randomBytes(32).toString('hex');
  let finish!: () => void;
  const stopped = new Promise<void>(resolve => { finish = resolve; });
  let closing = false;
  let service: LocalCanvasService | undefined;

  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await removeDaemonInfo(dataDir, controlToken);
    await service?.close();
    finish();
  };

  service = await LocalCanvasService.create({
    dataDir,
    distDir,
    controlToken,
    onShutdown: () => { void shutdown(); },
  });
  await writeDaemonInfo(dataDir, {
    protocol: SERVICE_PROTOCOL,
    version,
    pid: process.pid,
    origin: service.origin,
    controlToken,
  });

  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('beforeExit', () => { void removeDaemonInfo(dataDir, controlToken); });
  await stopped;
}
