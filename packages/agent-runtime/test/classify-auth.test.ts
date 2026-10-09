/**
 * classifyAuth —— 登录预检输出归一（claude JSON / codex 文本 / 未识别）。
 */

import { describe, expect, it } from 'vitest';
import { classifyAuth } from '../src/detect.ts';

describe('classifyAuth', () => {
  it('claude auth status 的 JSON 形状', () => {
    expect(classifyAuth(0, '{"loggedIn":true,"authMethod":"oauth_token"}'))
      .toMatchObject({ status: 'ok' });
    expect(classifyAuth(0, '{"loggedIn":false}'))
      .toMatchObject({ status: 'missing' });
  });

  it('codex login status 的文本形状', () => {
    expect(classifyAuth(0, 'Logged in using ChatGPT')).toMatchObject({ status: 'ok' });
    expect(classifyAuth(1, 'Not logged in. Run `codex login` first.'))
      .toMatchObject({ status: 'missing' });
  });

  it('认不出的措辞不妄断', () => {
    expect(classifyAuth(0, 'something odd')).toMatchObject({ status: 'unknown' });
    expect(classifyAuth(1, '')).toMatchObject({ status: 'unknown' });
  });

  it('非 JSON 的失败输出带登录线索时判 missing', () => {
    expect(classifyAuth(1, 'error: 请先登录')).toMatchObject({ status: 'missing' });
  });
});
