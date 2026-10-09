/**
 * claudeSettingsEnv / withClaudeSettingsEnv —— --restricted 下认证补偿的读取与优先级。
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeSettingsEnv, withClaudeSettingsEnv } from '../src/claude-env.ts';

function fakeHome(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-claude-env-'));
  fs.mkdirSync(path.join(dir, '.claude'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, '.claude', name), JSON.stringify(content));
  }
  return dir;
}

describe('claudeSettingsEnv', () => {
  it('合并 settings.json 与 settings.local.json（local 覆盖）', () => {
    const home = fakeHome({
      'settings.json': { env: { A: '1', B: '2' } },
      'settings.local.json': { env: { B: '22', C: '3' } },
    });
    expect(claudeSettingsEnv(home)).toEqual({ A: '1', B: '22', C: '3' });
  });

  it('文件缺失/损坏/env 形状不对都不抛错', () => {
    const home = fakeHome({ 'settings.json': { env: 'oops' } });
    expect(claudeSettingsEnv(home)).toEqual({});
    expect(claudeSettingsEnv(path.join(os.tmpdir(), 'mm-no-such-home'))).toEqual({});
  });

  it('非字符串 env 值跳过', () => {
    const home = fakeHome({ 'settings.json': { env: { OK: 'x', N: 1, OBJ: {} } } });
    expect(claudeSettingsEnv(home)).toEqual({ OK: 'x' });
  });
});

describe('withClaudeSettingsEnv', () => {
  it('settings 只补空缺：进程显式值优先', () => {
    const home = fakeHome({
      'settings.json': { env: { TOKEN: 'from-settings', MODEL: 'm1' } },
    });
    const out = withClaudeSettingsEnv({ TOKEN: 'from-process', OTHER: 'o' }, home);
    expect(out.TOKEN).toBe('from-process');
    expect(out.MODEL).toBe('m1');
    expect(out.OTHER).toBe('o');
  });

  it('进程里的空串视为未设置，settings 值补上（与 CLI 语义一致）', () => {
    const home = fakeHome({ 'settings.json': { env: { TOKEN: 'from-settings' } } });
    const out = withClaudeSettingsEnv({ TOKEN: '' }, home);
    expect(out.TOKEN).toBe('from-settings');
  });
});
