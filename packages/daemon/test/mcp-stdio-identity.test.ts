/**
 * agent 侧的**身份头**：环境变量 → HTTP 请求头。
 *
 * 工作稿目录按课件 id 落，而这个 id 是从 agent CLI 进程的环境变量传到 MCP 子进程、
 * 再由子进程上送 daemon 的（`mcp-stdio` → `tools-http` → `/api/*`）。这一段没有任何
 * 单测覆盖：断了不会报错，只会静默落到 `_default`——agent 写一份、daemon 读另一份。
 *
 * 这里用一个**桩 daemon** 把收到的头原样记下来，直接验证接线的两头。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_STDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp-stdio.ts');
const TOKEN = 'b'.repeat(64);

const spawned: ChildProcessWithoutNullStreams[] = [];
const servers: http.Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const p of spawned.splice(0)) { try { p.kill(); } catch { /* 已退出 */ } }
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** 桩 daemon：记下每次请求的头，回一份够用的 BoardState。 */
async function stubDaemon(): Promise<{ url: string; seen: Array<Record<string, string | string[] | undefined>> }> {
  const seen: Array<Record<string, string | string[] | undefined>> = [];
  const server = http.createServer((req, res) => {
    seen.push({ ...req.headers });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ commands: [], names: [], objects: {}, sliders: [], png: null, pngSource: 'none', generation: 1 }));
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, seen };
}

/** 起一个带给定环境变量的 mcp-stdio，调一次 ggb_get_state（只读，不碰画布）。 */
async function callGetState(daemonUrl: string, extraEnv: Record<string, string>): Promise<void> {
  // libraryToken() 读数据目录下的令牌文件——给个临时数据目录，别碰用户的
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-mcp-identity-'));
  dirs.push(dataDir);
  fs.writeFileSync(path.join(dataDir, '.local-access-token'), TOKEN, 'utf8');

  const proc = spawn(process.execPath, [MCP_STDIO], {
    env: { ...process.env, MATHMOVER_DATA_DIR: dataDir, MATHMOVER_DAEMON_URL: daemonUrl, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  spawned.push(proc);
  let buf = '';
  proc.stdout.on('data', (d) => { buf += d.toString(); });
  const wait = (pred: (j: any) => boolean) => new Promise<any | null>((resolve) => {
    const t0 = Date.now();
    const check = () => {
      for (const line of buf.split('\n').filter(Boolean)) {
        try { const j = JSON.parse(line); if (pred(j)) return resolve(j); } catch { /* 非 JSON 行 */ }
      }
      if (Date.now() - t0 > 15_000) return resolve(null);
      setTimeout(check, 50);
    };
    check();
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) + '\n');
  await wait((j) => j?.id === 1);
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ggb_get_state', arguments: { png: false } } }) + '\n');
  await wait((j) => j?.id === 2);
}

describe('agent 身份头', () => {
  it('窗口 id 与课件 id 一起上送，并带本地令牌', async () => {
    const { url, seen } = await stubDaemon();
    await callGetState(url, { MATHMOVER_WINDOW_ID: 'win-1', MATHMOVER_COURSEWARE_ID: 'courseware-1' });
    expect(seen.length).toBeGreaterThan(0);
    for (const headers of seen) {
      expect(headers['x-mathmover-window']).toBe('win-1');
      expect(headers['x-mathmover-courseware']).toBe('courseware-1');
      expect(headers['x-mathmover-token']).toBe(TOKEN);
    }
  });

  it('没有课件 id 时不送该头（daemon 那边落 _default）', async () => {
    const { url, seen } = await stubDaemon();
    await callGetState(url, { MATHMOVER_WINDOW_ID: 'win-1' });
    expect(seen.length).toBeGreaterThan(0);
    for (const headers of seen) {
      expect(headers['x-mathmover-window']).toBe('win-1');
      expect(headers['x-mathmover-courseware']).toBeUndefined();
    }
  });

  it('两个身份都没有时不送令牌（避免无谓地暴露它）', async () => {
    const { url, seen } = await stubDaemon();
    await callGetState(url, {});
    expect(seen.length).toBeGreaterThan(0);
    for (const headers of seen) {
      expect(headers['x-mathmover-window']).toBeUndefined();
      expect(headers['x-mathmover-token']).toBeUndefined();
    }
  });
});
