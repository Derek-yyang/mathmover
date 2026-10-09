/**
 * stream-json 校准：用真实 CLI 输出核对 agent-runtime 的 parseLine。
 *
 * 跑法（daemon 需在 8788）：
 *   node scripts/diag-stream-calibrate.mjs [claude-code|codex|dsh]
 * 原始输出存 spike-out/e2e/stream-raw-<id>.jsonl，解析映射打到 stdout。
 * 抓到的样本可直接 cp 成 packages/agent-runtime/test/fixtures/<id>-stream-sample.jsonl。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RUNTIMES } from '../packages/agent-runtime/src/defs.ts';
import { resolveSpawnTarget } from '../packages/agent-runtime/src/resolve.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const MCP_CONFIG = path.join(REPO_ROOT, 'spike-out', 'mcp', 'claude-mcp.json');
const runtimeId = process.argv[2] ?? 'claude-code';
const def = RUNTIMES.find((r) => r.id === runtimeId);
if (!def) {
  console.error(`未知运行时: ${runtimeId}`);
  process.exit(1);
}

const RAW_OUT = path.join(REPO_ROOT, 'spike-out', 'e2e', `stream-raw-${runtimeId}.jsonl`);
const prompt = '调用 ggb_get_state 看一下画布当前状态，然后用一句话说你看到了什么。';

const target = resolveSpawnTarget(def.executable);
if (!target) {
  console.error(`${def.executable} 不可用`);
  process.exit(1);
}

const args = def.buildArgs({ prompt, mcpConfigPath: MCP_CONFIG });
console.log('spawn:', target.command, args.join(' '));
const proc = spawn(target.command, [...target.prefixArgs, ...args], {
  cwd: REPO_ROOT,
  env: process.env,
  windowsHide: true,
});

const raw = fs.createWriteStream(RAW_OUT, 'utf-8');
let buf = '';
const seenKinds = new Map();

// prompt 走 argv；关 stdin 免得 codex 空等（"Reading additional input from stdin..."）
proc.stdin.end();

const handle = (line) => {
  if (!line.trim()) return;
  raw.write(line + '\n');
  let parsed;
  try {
    parsed = def.parseLine(line) ?? { kind: '(dropped)' };
  } catch (err) {
    parsed = { kind: 'error', message: `parseLine 抛错: ${err.message}` };
  }
  const preview = JSON.stringify(parsed).slice(0, 100);
  seenKinds.set(parsed.kind, (seenKinds.get(parsed.kind) ?? 0) + 1);
  console.log(`${line.slice(0, 60).padEnd(62)} -> ${parsed.kind} ${preview}`);
};

proc.stdout.on('data', (d) => {
  buf += d.toString();
  const parts = buf.split('\n');
  buf = parts.pop() ?? '';
  for (const l of parts) handle(l);
});
proc.stderr.on('data', (d) => {
  for (const l of d.toString().split('\n')) {
    if (l.trim()) console.log(`[stderr] ${l.slice(0, 120)}`);
  }
});

proc.on('close', (code) => {
  if (buf.trim()) handle(buf);
  raw.end();
  console.log('\n=== 归一事件统计 ===');
  for (const [k, n] of seenKinds) console.log(`  ${k}: ${n}`);
  console.log(`exit=${code}  原始输出 -> ${RAW_OUT}`);
});
