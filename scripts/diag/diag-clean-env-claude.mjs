/**
 * 用「干净环境」精确复现路由的 spawn（无 ANTHROPIC_*、无 CLAUDE_* harness 变量），
 * 对比带 harness 变量的情况，定位 Not logged in 的触发条件。临时诊断用。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSpawnTarget } from '../../packages/agent-runtime/src/resolve.ts';

// 仓库根从脚本自身位置推，不写死盘符（换机器/换克隆位置要能直接跑）
const REPO = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TARGET = resolveSpawnTarget('claude');
if (!TARGET) {
  console.error('claude 不可用');
  process.exit(1);
}
const MCP_CONFIG = path.join(REPO, 'spike-out', 'mcp', 'claude-mcp.json');

const routeArgs = [
  '-p', '回复OK两个字母即可',
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--mcp-config', MCP_CONFIG,
  '--restricted',
];

function minimalEnv() {
  // 模拟「用户终端起的 server」：只有系统必需变量
  const src = process.env;
  const env = {};
  for (const k of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
    'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'NUMBER_OF_PROCESSORS', 'OS']) {
    if (src[k]) env[k] = src[k];
  }
  env.HOME = src.USERPROFILE;
  return env;
}

function run(name, env) {
  const r = spawnSync(TARGET.command, [...TARGET.prefixArgs, ...routeArgs], {
    encoding: 'utf-8', timeout: 90_000, windowsHide: true, env,
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = (r.stdout || '') + '\n' + (r.stderr || '');
  const login = out.includes('Not logged in');
  const hasResult = /"type":"result"/.test(out);
  console.log(`${name}: status=${r.status} notLoggedIn=${login} hasResult=${hasResult}`);
  if (login || r.status !== 0) {
    for (const l of out.split('\n')) {
      if (/logged|error|Error|denied|401|unauthorized/i.test(l)) console.log('   |', l.slice(0, 160));
    }
  }
}

run('最小环境（无 ANTHROPIC/CLAUDE 变量）', minimalEnv());
run('最小环境 + harness 的 CLAUDE_* 变量', (() => {
  const env = minimalEnv();
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('CLAUDE')) env[k] = v;
  return env;
})());

// ── 2×2：环境 × 参数 ─────────────────────────────────────
const simpleArgs = ['-p', '回复OK两个字母即可', '--output-format', 'json'];
const fullEnv = (() => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('ANTHROPIC_')) delete env[k];
  return env;
})();

function run2(name, env, args) {
  const r = spawnSync(TARGET.command, [...TARGET.prefixArgs, ...args], {
    encoding: 'utf-8', timeout: 90_000, windowsHide: true, env,
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = (r.stdout || '') + (r.stderr || '');
  console.log(`${name}: status=${r.status} notLoggedIn=${out.includes('Not logged in')}`);
}

run2('最小环境 × 简单参数', minimalEnv(), simpleArgs);
run2('最小环境 × 路由参数', minimalEnv(), routeArgs);
run2('全环境(剥ANTHROPIC) × 简单参数', fullEnv, simpleArgs);
run2('全环境(剥ANTHROPIC) × 路由参数', fullEnv, routeArgs);

// ── 参数二分：全环境(剥ANTHROPIC)下逐个加参数 ─────────────────
const base = ['-p', '回复OK两个字母即可', '--output-format', 'json'];
const variants = {
  '仅基础': base,
  '基础+--restricted': [...base, '--restricted'],
  '基础+--mcp-config': [...base, '--mcp-config', MCP_CONFIG],
  '基础+stream-json+verbose': ['-p', '回复OK两个字母即可', '--output-format', 'stream-json', '--verbose'],
  '基础+--include-partial-messages': [...base, '--include-partial-messages'],
};
for (const [name, args] of Object.entries(variants)) {
  run2(name, fullEnv, args);
}

// ── 验证 --allowedTools 白名单替代 --restricted ─────────────────
const allowArgs = [
  '-p', '调用 ggb_get_state 看一下画布，然后一句话说你看到了什么。另外：如果你有 Bash 工具就运行 echo hi 并报告输出，没有就说没有 Bash。',
  '--output-format', 'stream-json', '--verbose',
  '--mcp-config', MCP_CONFIG,
  '--allowedTools', 'mcp__mathmover__*',
];
const r3 = spawnSync(TARGET.command, [...TARGET.prefixArgs, ...allowArgs], {
  encoding: 'utf-8', timeout: 90_000, windowsHide: true, env: fullEnv,
  cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
});
const out3 = (r3.stdout || '') + (r3.stderr || '');
console.log('allowedTools 替代: status=' + r3.status, 'notLoggedIn=' + out3.includes('Not logged in'));
for (const l of out3.split('\n')) {
  try {
    const e = JSON.parse(l);
    if (e.type === 'system' && e.subtype === 'init') {
      const names = (e.tools || []).map((t) => (typeof t === 'string' ? t : t.name));
      console.log('  init tools:', names.join(','));
      console.log('  含 Bash?', names.some((n) => /bash/i.test(n)), '| 含 ggb?', names.some((n) => /ggb_get_state/.test(n)));
    }
    if (e.type === 'assistant') {
      for (const b of e.message?.content ?? []) {
        if (b.type === 'tool_use') console.log('  tool_use:', b.name);
        if (b.type === 'text') console.log('  text:', String(b.text).slice(0, 120));
      }
    }
    if (e.type === 'result') console.log('  result:', String(e.result ?? '').slice(0, 140));
  } catch {}
}
