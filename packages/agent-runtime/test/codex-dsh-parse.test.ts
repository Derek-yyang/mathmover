/**
 * Codex / dsh 解析回归（2026-10-09 真实输出样本重放）。
 *
 * 夹具来自 scripts/diag-stream-calibrate.mjs <runtime> 的真实抓样：
 * - codex-stream-sample.jsonl：一次 ggb_get_state 调用 + 两句 agent_message（JSONL）
 * - dsh-output-sample.txt：one-shot 纯文本最终消息
 * 解析规则改动后重放防退化；抓新样本可直接覆盖夹具。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codex, dsh, type AgentEvent } from '../src/defs.ts';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function replay(def: typeof codex | typeof dsh, line: string): AgentEvent[] {
  const parsed = def.parseLine(line);
  if (!parsed) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

describe('codex.parseLine — 真实样本重放', () => {
  const lines = fs.readFileSync(fixture('codex-stream-sample.jsonl'), 'utf-8').split('\n').filter((l) => l.trim());
  const events = lines.flatMap((l) => replay(codex, l));

  it('thread.started 带出 session', () => {
    const s = events.find((e) => e.kind === 'session');
    expect(s?.kind === 'session' && s.sessionId).toBeTruthy();
  });

  it('tool-call/tool-result 成对且名字干净', () => {
    const calls = events.filter((e) => e.kind === 'tool-call');
    const results = events.filter((e) => e.kind === 'tool-result');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBe(results.length);
    if (calls[0].kind === 'tool-call') {
      expect(calls[0].name).toBe('ggb_get_state');
      expect(calls[0].toolCallId).toBeTruthy();
    }
  });

  it('agent_message 有自然语言、usage 有数', () => {
    const texts = events.filter((e) => e.kind === 'text');
    expect(texts.length).toBeGreaterThan(0);
    const usage = events.find((e) => e.kind === 'usage');
    expect(usage?.kind === 'usage' && usage.outputTokens).toBeTruthy();
  });

  it('每行不抛错、无 error 事件（样本是成功运行）', () => {
    for (const l of lines) expect(() => codex.parseLine(l)).not.toThrow();
    expect(events.filter((e) => e.kind === 'error').length).toBe(0);
  });
});

describe('dsh.parseLine — 真实样本重放', () => {
  const lines = fs.readFileSync(fixture('dsh-output-sample.txt'), 'utf-8').split('\n');

  it('纯文本行 → text（带换行），空行不下发', () => {
    const events = lines.flatMap((l) => replay(dsh, l));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.kind).toBe('text');
      if (e.kind === 'text') expect(e.text.endsWith('\n')).toBe(true);
    }
  });

  it('buildArgs 用 --patch 挂 MCP 补丁、--profile headless', () => {
    // 路径故意与真实布局无关：这里锁的是「patch 跟着配置走」这条契约
    // （defs.ts 用 path.dirname(mcpConfigPath) 定位补丁），不是某个具体目录。
    const cfg = 'X:/any/dir/claude-mcp.json';
    const args = dsh.buildArgs({ prompt: '你好', mcpConfigPath: cfg });
    const patchIdx = args.indexOf('--patch');
    expect(patchIdx).toBeGreaterThanOrEqual(0);
    expect(path.dirname(args[patchIdx + 1].replace(/\\/g, '/'))).toBe(path.dirname(cfg));
    expect(args[patchIdx + 1]).toMatch(/dsh-mathmover\.patch\.yml$/);
    expect(args).toContain('--profile');
    expect(args[args.indexOf('--profile') + 1]).toBe('headless');
    expect(args[args.length - 1]).toBe('你好');
  });
});

describe('codex.buildArgs — 权限收敛组合（实测唯一可用）', () => {
  // 真实的 claude 方言 MCP 配置文件（codexMcpArgs 要读它做翻译）
  const mcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-mcp-'));
  const mcpPath = `${mcpDir}/claude-mcp.json`;
  fs.writeFileSync(mcpPath, JSON.stringify({
    mcpServers: {
      mathmover: {
        command: 'node',
        args: ['packages/daemon/src/mcp-stdio.ts'],
        env: { MATHMOVER_DAEMON_URL: 'http://127.0.0.1:8788' },
      },
    },
  }));

  const args = codex.buildArgs({ prompt: '你好', mcpConfigPath: mcpPath });

  it('走 exec + --json + config 形式 read-only + per-server 免审批', () => {
    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
    expect(args).not.toContain('--approve-for-me'); // resume 用不了它，统一走配置键
    const sb = args.indexOf('sandbox_mode="read-only"');
    expect(sb).toBeGreaterThan(0);
    expect(args[sb - 1]).toBe('-c');
    expect(args.some((a) => a.includes('default_tools_approval_mode="approve"'))).toBe(true);
  });

  it('多轮走 exec resume <id> 位置参数，prompt 经 stdin（-）', () => {
    const r = codex.buildArgs({ prompt: '你好', mcpConfigPath: mcpPath, resumeSessionId: 't-42' });
    expect(r.slice(0, 3)).toEqual(['exec', 'resume', 't-42']);
    expect(r).toContain('-'); // stdin 哨兵
    expect(r).not.toContain('你好'); // prompt 不进 argv
  });

  it('MCP 配置翻译成 -c mcp_servers.* 键值（claude 方言的文件被翻译而非直传）', () => {
    expect(args).toContain('-c');
    expect(args.some((a) => a.startsWith('mcp_servers.') && a.includes('.command='))).toBe(true);
    expect(args.some((a) => a.includes('mcp_tool_approval'))).toBe(false); // 假键，别再出现
    expect(args).not.toContain('--mcp-config');
  });
});
