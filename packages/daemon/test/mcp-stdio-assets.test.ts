/**
 * skill 资产根目录**不能靠 cwd 推**。
 *
 * agent 的 cwd 是每窗口沙箱（落数据目录），那里只有工作稿、没有
 * `ggb_commands.json` / `skills/`。mcp-stdio 早期用 `process.cwd()` 当 rootDir，
 * 结果 ggb_apply 好好的（只碰工作稿），get_expert_prompt /
 * get_sop_cards 全 ENOENT（实测：一轮里连报两次错）。
 *
 * 本测试从**临时目录**起 mcp-stdio——正是翻车场景。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_STDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'mcp-stdio.ts');
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const spawned: ChildProcessWithoutNullStreams[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
  for (const p of spawned.splice(0)) { try { p.kill(); } catch { /* 已退出 */ } }
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

/** 从 sandboxDir 起 mcp-stdio（cwd = 沙箱），走真 stdio 协议调工具。 */
async function callFromSandbox(
  name: string,
  args: Record<string, unknown>,
  daemonUrl = 'http://127.0.0.1:1',
): Promise<{ isError?: boolean; text: string }> {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-mcp-sandbox-'));
  const proc = spawn(process.execPath, [MCP_STDIO], {
    cwd: sandbox,
    env: { ...process.env, MATHMOVER_DAEMON_URL: daemonUrl },  // 默认指向不存在的 daemon：只测资产读取
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  spawned.push(proc);
  let buf = '';
  proc.stdout.on('data', (d) => { buf += d.toString(); });
  const send = (m: unknown) => proc.stdin.write(JSON.stringify(m) + '\n');
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
  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    await wait((j) => j?.id === 1);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
    const r = await wait((j) => j?.id === 2);
    const text = (r?.result?.content ?? [])
      .filter((c: { type: string; text?: string }) => c.type === 'text')
      .map((c: { text?: string }) => c.text ?? '')
      .join('\n');
    return { isError: r?.result?.isError === true, text };
  } finally {
    // 先杀子进程再删沙箱：子进程把沙箱当 cwd，Windows 上不杀会 EPERM
    try { proc.kill(); } catch { /* 已退出 */ }
    const index = spawned.indexOf(proc);
    if (index >= 0) spawned.splice(index, 1);
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* 残留不致命 */ }
  }
}

describe('skill 资产根目录与 cwd 解耦', () => {
  it('get_expert_prompt 从沙箱里也能取到（不靠 cwd 找 skills/）', async () => {
    const r = await callFromSandbox('get_expert_prompt', { category: 'C' });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('共同输出约定');
  });

  it('get_sop_cards 从沙箱里也能取到卡正文', async () => {
    const r = await callFromSandbox('get_sop_cards', { names: ['intersection'] });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('intersection');
  });

  it('ggb_apply 从沙箱里能读到命令白名单（不 ENOENT）', async () => {
    // 工作稿在沙箱里；白名单 ggb_commands.json 在仓库根。校验（行级 + 动点自洽）已并进
    // ggb_apply，所以这条路径必须能在沙箱里读到仓库根的资产——当初翻车正是这里
    // （资产根靠 cwd 推 → submit/apply 连报 ENOENT）。
    // 需要一个桩 daemon：apply 得真回一份账本，校验才有东西可查。
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      // 工作稿端点回数组（ggb_apply 会先读草稿再校验）；其余回 /api/apply 的形状。
      // 注意 daemon 的 /api/apply 返回的是**已组装的 BoardState**（不是 RawState），
      // 字段少了 describeState/describeDiff 会崩。
      if (req.url?.startsWith('/api/construction')) {
        return res.end(JSON.stringify(['A = (0, 0)', 'Tangnet(A, 1)']));
      }
      res.end(JSON.stringify({
        applied: [], failedFirstPass: [], durationMs: 1,
        diff: { entries: [], unchangedCount: 0, summary: '（桩）' },
        state: {
          commands: ['A = (0, 0)', 'Tangnet(A, 1)'],
          objects: [], sliders: [],
          png: { base64: null, source: null, width: null, height: null, nonBlank: null },
          audit: { findings: [], degraded: false },
          mode: '2D', generation: 1, degraded: false, degradedReasons: [],
        },
      }));
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const r = await callFromSandbox('ggb_apply', { png: false }, url);
    expect(r.text).not.toContain('ENOENT');
    expect(r.text).not.toContain('ggb_commands.json');
    // 校验真的跑起来了：桩回的那行未知命令被点名（说明白名单读到了）
    expect(r.text).toContain('Tangnet(A, 1)');
  });
});
