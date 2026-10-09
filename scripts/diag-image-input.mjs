/**
 * 图片输入通道校准：claude 的 --input-format stream-json 图片块形状、codex 的 -i。
 * 临时诊断用。用 public/cases/case1.png 真题图，问"图里画了什么"验证视觉。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveSpawnTarget } from '../packages/agent-runtime/src/resolve.ts';

const REPO = path.resolve(import.meta.dirname, '..');
const IMG = path.join(REPO, 'math-mover-next/public/cases/case1.png');
const b64 = fs.readFileSync(IMG).toString('base64');
const ASK = '用一句话描述这张题目图画了什么、要求什么。';

function run(name, bin, args, opts = {}) {
  const r = spawnSync(bin, args, {
    encoding: 'utf-8', timeout: 120_000, windowsHide: true, cwd: REPO,
    stdio: ['ignore', 'pipe', 'pipe'], ...opts,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  console.log(`\n=== ${name} exit=${r.status} ===`);
  for (const l of out.split('\n')) {
    if (!l.trim()) continue;
    if (l.startsWith('{')) {
      try {
        const e = JSON.parse(l);
        if (e.type === 'result') console.log('RESULT:', String(e.result ?? '').slice(0, 200));
        else if (e.type === 'assistant') {
          for (const b of e.message?.content ?? []) if (b.type === 'text') console.log('TEXT:', String(b.text).slice(0, 200));
        } else if (e.item?.type === 'agent_message') console.log('TEXT:', String(e.item.text).slice(0, 200));
      } catch { console.log('RAW:', l.slice(0, 150)); }
    } else {
      console.log('ERR:', l.slice(0, 150));
    }
  }
}

// ── claude：stream-json 输入的候选形状 A（Anthropic content blocks）──
{
  const t = resolveSpawnTarget('claude');
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--restricted',
  ];
  const lineA = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
        { type: 'text', text: ASK },
      ],
    },
  });
  run('claude 形状A: user.message.content[]', t.command, [...t.prefixArgs, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    input: lineA + '\n',
  });
}

// ── codex：-i 文件路径（-i 是变长旗标，prompt 前要 -- 终结）──
{
  const t = resolveSpawnTarget('codex');
  const args = ['exec', '--json', '--skip-git-repo-check', '-s', 'read-only', '-i', IMG, '--', ASK];
  run('codex -i file.png + -- prompt', t.command, [...t.prefixArgs, ...args]);
}
