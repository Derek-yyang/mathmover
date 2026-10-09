/** 测 codex MCP 工具的审批放行开关（严格判定：只看 mcp_tool_call 项的 status）。临时诊断用。 */
import { spawnSync } from 'node:child_process';
import { resolveSpawnTarget } from '../packages/agent-runtime/src/resolve.ts';

const target = resolveSpawnTarget('codex');
if (!target) {
  console.error('codex 不可用');
  process.exit(1);
}

const MCP = [
  '-c', 'mcp_servers.mathmover.command="node"',
  '-c', 'mcp_servers.mathmover.args=["packages/daemon/src/mcp-stdio.ts"]',
  '-c', 'mcp_servers.mathmover.env.MATHMOVER_DAEMON_URL="http://127.0.0.1:8788"',
];
const PROMPT = '调用 ggb_get_state 看一眼画布';

const variants = {
  'A: --approve-for-me（无 -s）': ['exec', '--json', '--skip-git-repo-check', '--approve-for-me', ...MCP, PROMPT],
  'E: -s read-only + approval_policy=on-failure': ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-c', 'approval_policy="on-failure"', ...MCP, PROMPT],
  'F: -s read-only + approval_policy=untrusted': ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-c', 'approval_policy="untrusted"', ...MCP, PROMPT],
  'G: -s read-only + approval_policy=on-request': ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-c', 'approval_policy="on-request"', ...MCP, PROMPT],
};

for (const [name, args] of Object.entries(variants)) {
  const r = spawnSync(target.command, [...target.prefixArgs, ...args], {
    encoding: 'utf-8', timeout: 120_000, windowsHide: true, cwd: 'D:/Mathmover',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = (r.stdout || '') + (r.stderr || '');
  // 严格判定：只认 mcp_tool_call 项
  let verdict = '未发生工具调用';
  for (const l of out.split('\n')) {
    try {
      const e = JSON.parse(l);
      const item = e.item;
      if (e.type === 'item.completed' && item?.type === 'mcp_tool_call') {
        verdict = item.status === 'completed' && !item.error
          ? '工具调用成功'
          : `被拦/失败: ${JSON.stringify(item.error ?? item.status).slice(0, 90)}`;
      }
    } catch {}
  }
  const ignored = out.match(/is ignored/)?.[0] ? '（有未识别配置键）' : '';
  console.log(`${name}: exit=${r.status} ${verdict}${ignored}`);
}

// H: --approve-for-me + config 形式的 read-only 沙箱（旗标互斥，配置键未必）
const H = ['exec', '--json', '--skip-git-repo-check', '--approve-for-me', '-c', 'sandbox_mode="read-only"', ...MCP, PROMPT];
{
  const r = spawnSync(target.command, [...target.prefixArgs, ...H], {
    encoding: 'utf-8', timeout: 120_000, windowsHide: true, cwd: 'D:/Mathmover',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = (r.stdout || '') + (r.stderr || '');
  let verdict = '未发生工具调用';
  for (const l of out.split('\n')) {
    try {
      const e = JSON.parse(l);
      const item = e.item;
      if (e.type === 'item.completed' && item?.type === 'mcp_tool_call') {
        verdict = item.status === 'completed' && !item.error
          ? '工具调用成功'
          : `被拦/失败: ${JSON.stringify(item.error ?? item.status).slice(0, 90)}`;
      }
    } catch {}
  }
  const conflict = out.match(/cannot be combined|conflict|invalid/i)?.[0] ?? '';
  console.log(`H: --approve-for-me + sandbox_mode=read-only: exit=${r.status} ${verdict} ${conflict}`);
}

// I 系列：default_tools_approval_mode 取值探测（不带 --approve-for-me，等价 resume 的权限面）
const MODES = ['auto', 'always', 'never', 'on_request', 'on-request'];
for (const mode of MODES) {
  const args = ['exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"',
    '-c', `mcp_servers.mathmover.default_tools_approval_mode="${mode}"`,
    ...MCP, PROMPT];
  const r = spawnSync(target.command, [...target.prefixArgs, ...args], {
    encoding: 'utf-8', timeout: 120_000, windowsHide: true, cwd: 'D:/Mathmover',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = (r.stdout || '') + (r.stderr || '');
  let verdict = '未发生工具调用';
  for (const l of out.split('\n')) {
    try {
      const e = JSON.parse(l);
      const item = e.item;
      if (e.type === 'item.completed' && item?.type === 'mcp_tool_call') {
        verdict = item.status === 'completed' && !item.error ? '工具调用成功' : `被拦/失败: ${JSON.stringify(item.error ?? item.status).slice(0, 80)}`;
      }
    } catch {}
  }
  const ignored = out.match(/is ignored/)?.[0] ? '（未识别键）' : '';
  console.log(`I[${mode}]: exit=${r.status} ${verdict}${ignored}`);
}

// J: default_tools_approval_mode="approve"（per-server 配置键，exec/resume 通用）
{
  const args = ['exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"',
    '-c', 'mcp_servers.mathmover.default_tools_approval_mode="approve"',
    ...MCP, PROMPT];
  const r = spawnSync(target.command, [...target.prefixArgs, ...args], {
    encoding: 'utf-8', timeout: 120_000, windowsHide: true, cwd: 'D:/Mathmover',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = (r.stdout || '') + (r.stderr || '');
  let verdict = '未发生工具调用';
  for (const l of out.split('\n')) {
    try {
      const e = JSON.parse(l);
      const item = e.item;
      if (e.type === 'item.completed' && item?.type === 'mcp_tool_call') {
        verdict = item.status === 'completed' && !item.error ? '工具调用成功' : `被拦/失败: ${JSON.stringify(item.error ?? item.status).slice(0, 80)}`;
      }
    } catch {}
  }
  const ignored = out.match(/is ignored/)?.[0] ? '（未识别键）' : '';
  console.log(`J[approve 无 --approve-for-me]: exit=${r.status} ${verdict}${ignored}`);
}
