/** 测哪些环境形态会干扰 claude 从 settings.json 自加载认证配置。临时诊断用。 */
import { spawnSync } from 'node:child_process';
import { resolveSpawnTarget } from '../packages/agent-runtime/src/resolve.ts';

const TARGET = resolveSpawnTarget('claude');
if (!TARGET) {
  console.error('claude 不可用');
  process.exit(1);
}
const cases = {
  '空串 ANTHROPIC_AUTH_TOKEN': { ANTHROPIC_AUTH_TOKEN: '' },
  '空串 CLAUDE_CONFIG_DIR': { CLAUDE_CONFIG_DIR: '' },
  '错的 ANTHROPIC_API_KEY': { ANTHROPIC_API_KEY: 'bogus' },
  '空串 ANTHROPIC_BASE_URL': { ANTHROPIC_BASE_URL: '' },
  '空串 HOME+USERPROFILE': { HOME: '', USERPROFILE: '' },
};

for (const [name, over] of Object.entries(cases)) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('ANTHROPIC_')) delete env[k];
  Object.assign(env, over);
  const r = spawnSync(TARGET.command, [...TARGET.prefixArgs, '-p', '回复OK即可', '--output-format', 'json'], {
    encoding: 'utf-8', timeout: 40000, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = (r.stdout || '') + (r.stderr || '');
  let verdict;
  if (r.status === 0) verdict = 'OK';
  else {
    const m = out.match(/Not logged in|error|Error|invalid/i);
    verdict = m ? m[0] : `status=${r.status} out=${out.slice(0, 80)}`;
  }
  console.log(name.padEnd(28), '->', verdict);
}
