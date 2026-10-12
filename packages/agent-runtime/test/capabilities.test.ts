/**
 * 值拒绝探针（对齐 OpenDesign 的 hiddenCapabilityFlags）。
 *
 * 锁住的语义：
 * - 判定规则按报错**阶段**分类（2026-10-12 实测裁决）：未知旗标类 → false；
 *   其他任何输出（值校验/缺输入）→ true；空输出 → false。
 *   误判「真」= 维持今天照传的行为，误判「假」= 摘旗标降级——宽松方向是安全方向。
 * - buildArgs 闸门：探针证实「不认识」才摘旗标；没探过照传（不能让绕过 detect 的
 *   直调静默丢会话）。
 * - 只适用带值旗标（布尔旗标的假值会被当 prompt 真发模型调用——探针禁区）。
 *
 * 报错样本取自 2026-10-12 本机实测：claude 2.1.296 / codex 0.162.1。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { classifyHiddenProbeOutput, clearCapabilities, setCapabilities, getCapabilities } from '../src/capabilities.ts';
import { claudeCode, codex, dsh, resumesSession, PROBE_FAKE_THREAD_ID } from '../src/defs.ts';

afterEach(() => clearCapabilities());

describe('classifyHiddenProbeOutput — 实测报错形状', () => {
  it('claude --session-id 假值：不点名旗标也不点名假值，仍算认识（解析已过旗标）', () => {
    expect(classifyHiddenProbeOutput('Error: Invalid session ID. Must be a valid UUID.')).toBe(true);
  });

  it('claude --resume 假值：点名旗标的值校验报错', () => {
    expect(classifyHiddenProbeOutput(
      'Error: --resume requires a valid session ID or session title when used with --print. ' +
      'Provided value "__mm_capability_probe__" is not a UUID and does not match any session title.',
    )).toBe(true);
  });

  it('claude --model 假值：目录告警 + 缺输入，都是解析之后的阶段', () => {
    expect(classifyHiddenProbeOutput(
      '"__mm_capability_probe__" isn\'t described by this version\'s model catalog; update Claude Code.\n' +
      'Error: Input must be provided either through stdin or as a prompt argument when using --print',
    )).toBe(true);
  });

  it('codex exec 空 stdin 短路：解析已过旗标', () => {
    expect(classifyHiddenProbeOutput('No prompt provided via stdin.')).toBe(true);
  });

  it('codex exec resume 假线程：查不到 rollout，解析已过旗标', () => {
    expect(classifyHiddenProbeOutput(
      `Error: thread/resume: thread/resume failed: no rollout found for thread id ${PROBE_FAKE_THREAD_ID} (code -32600)`,
    )).toBe(true);
  });

  it('未知旗标类措辞一律 false', () => {
    expect(classifyHiddenProbeOutput("error: unknown option '--thinking-display'")).toBe(false);
    expect(classifyHiddenProbeOutput("error: unexpected argument '--model' found")).toBe(false);
    expect(classifyHiddenProbeOutput("unrecognized option '--foo'")).toBe(false);
    expect(classifyHiddenProbeOutput('No such option: --foo')).toBe(false);
  });

  it('空输出（spawn 失败/超时无字节）→ 没有证据', () => {
    expect(classifyHiddenProbeOutput('')).toBe(false);
    expect(classifyHiddenProbeOutput('  \n ')).toBe(false);
  });
});

describe('buildArgs 闸门：证实不认识才摘，没探过照传', () => {
  const claudeArgs = (extra: Partial<Parameters<typeof claudeCode.buildArgs>[0]> = {}) =>
    claudeCode.buildArgs({ prompt: 'p', mcpConfigPath: 'x.json', ...extra });

  it('没探过（如绕过 detect 直调）：会话/模型旗标照传', () => {
    expect(getCapabilities('claude-code')).toBeUndefined();
    const args = claudeArgs({ sessionId: 's1', resumeSessionId: 'r1', model: 'opus' });
    expect(args).toContain('--session-id');
    expect(args).toContain('--resume');
    expect(args).toContain('--model');
  });

  it('探针证实不认识：三个旗标都摘掉，其余照传', () => {
    setCapabilities('claude-code', { sessionFlag: false, resumeFlag: false, modelFlag: false });
    const args = claudeArgs({ sessionId: 's1', resumeSessionId: 'r1', model: 'opus' });
    expect(args).not.toContain('--session-id');
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--model');
    expect(args).toContain('--restricted');   // 不可摘的安全收敛不动
  });

  it('探针证实认识：照传', () => {
    setCapabilities('claude-code', { sessionFlag: true, resumeFlag: true, modelFlag: true });
    const args = claudeArgs({ sessionId: 's1', model: 'opus' });
    expect(args).toContain('--session-id');
    expect(args).toContain('--model');
  });

  it('codex 的 --model 按 exec / exec resume 分键取舍（旗标集不同，实测踩过）', () => {
    setCapabilities('codex', { modelFlag: false, resumeModelFlag: true });
    const fresh = codex.buildArgs({ prompt: 'p', mcpConfigPath: 'x.json', model: 'gpt-x' });
    expect(fresh).not.toContain('--model');
    const resumed = codex.buildArgs({ prompt: 'p', mcpConfigPath: 'x.json', resumeSessionId: 't1', model: 'gpt-x' });
    expect(resumed).toContain('--model');
  });

  it('推理档位翻译：claude --effort / codex -c model_reasoning_effort（不设 = 用 agent 自己的配置）', () => {
    // claude：照传（没探过）；探针证实不认识 --effort 时摘掉
    expect(claudeCode.buildArgs({ prompt: 'p', mcpConfigPath: 'x.json', reasoningEffort: 'high' }))
      .toContain('--effort');
    setCapabilities('claude-code', { effortFlag: false });
    const dropped = claudeCode.buildArgs({ prompt: 'p', mcpConfigPath: 'x.json', reasoningEffort: 'high' });
    expect(dropped).not.toContain('--effort');
    clearCapabilities();
    expect(claudeCode.buildArgs({ prompt: 'p', mcpConfigPath: 'x.json' })).not.toContain('--effort');

    // codex：config 同名键，exec 与 exec resume 都带上；不设不加键
    const fresh = codex.buildArgs({ prompt: 'p', mcpConfigPath: 'x.json', reasoningEffort: 'xhigh' });
    expect(fresh).toContain('model_reasoning_effort="xhigh"');
    const resumed = codex.buildArgs({ prompt: 'p', mcpConfigPath: 'x.json', resumeSessionId: 't1', reasoningEffort: 'xhigh' });
    expect(resumed).toContain('model_reasoning_effort="xhigh"');
    expect(codex.buildArgs({ prompt: 'p', mcpConfigPath: 'x.json' }).some((a) => a.includes('model_reasoning_effort'))).toBe(false);
  });
});

describe('resumesSession — 会话语法分类学', () => {
  it('CLI 旗标式与 profile-stdio 式都算原生会话', () => {
    expect(resumesSession({ resumesSessionViaCli: true })).toBe(true);
    expect(resumesSession({ resumesSessionViaProfileStdio: true })).toBe(true);
    expect(resumesSession({})).toBe(false);
    expect(resumesSession({ resumesSessionViaCli: false })).toBe(false);
  });

  it('三家声明齐全：原生会话绝不注入转写（双重上下文是 OpenDesign 的教训）', () => {
    expect(claudeCode.resumesSessionViaCli).toBe(true);
    expect(codex.resumesSessionViaCli).toBe(true);
    expect(codex.capturesSessionIdFromStream).toBe(true);   // capture-style
    expect(claudeCode.capturesSessionIdFromStream).toBeFalsy(); // specify-style
    expect(dsh.resumesSessionViaProfileStdio).toBe(true);
    expect(resumesSession(dsh)).toBe(true);
    expect(resumesSession(claudeCode)).toBe(true);
    expect(resumesSession(codex)).toBe(true);
  });
});
