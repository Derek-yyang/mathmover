/**
 * 探测本机装了哪些 agent CLI（OpenDesign 的 PATH 扫描模式）。
 *
 * 只看「能不能跑出版本」，不做网络探测、不改配置。
 * 探测失败不抛错——返回 usable=false，上层据此提示用户装哪个。
 */

import { RUNTIMES, type RuntimeDefinition, type RuntimeVersionPolicy } from './defs.ts';
import { resolveRuntimeTarget, type SpawnTarget } from './resolve.ts';
import { classifyHiddenProbeOutput, HIDDEN_FLAG_PROBE_VALUE, setCapabilities } from './capabilities.ts';
import { spawnCapture } from './spawn.ts';

export interface DetectedRuntime {
  def: RuntimeDefinition;
  /** 解析出的版本串；探测不到为 null */
  version: string | null;
  /** 能被 buildArgs 使用 */
  usable: boolean;
  /** 版本策略警告（未验证版本/拒启原因）；没问题不带 */
  versionWarning?: string;
  /** 登录预检结论（仅声明了 authProbe 的运行时会探测） */
  authStatus?: 'ok' | 'missing' | 'unknown';
  authMessage?: string;
  /** 解析后的 spawn 目标。模型发现（listModels）要按这个起进程——
   *  npm 的 .cmd shim 解析后 command 是 node、脚本在 prefixArgs 里。 */
  target?: { command: string; prefixArgs?: string[] };
}

/**
 * 把 authProbe 的输出归一成登录结论。
 * - claude auth status → JSON `{ loggedIn: boolean, authMethod? }`
 * - codex login status → 文本 "Logged in using ..."
 * 认不出措辞时不妄断：unknown 只是"没提示"，不影响 usable。
 */
export function classifyAuth(
  exitCode: number | null,
  output: string,
): { status: 'ok' | 'missing' | 'unknown'; message?: string } {
  const text = output.trim();
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text) as { loggedIn?: unknown; authMethod?: unknown };
      if (typeof j.loggedIn === 'boolean') {
        return j.loggedIn
          ? { status: 'ok', message: j.authMethod ? `已登录（${String(j.authMethod)}）` : '已登录' }
          : { status: 'missing', message: '未登录，请先在终端登录该 agent CLI' };
      }
    } catch {
      /* 不是 JSON，走文本匹配 */
    }
  }
  if (/not logged in|logged out|未登录|请.{0,4}登录|please run .*login|needs? (to )?log ?in/i.test(text)) {
    return { status: 'missing', message: text.split('\n')[0].slice(0, 80) };
  }
  if (/logged in/i.test(text)) {
    return { status: 'ok', message: text.split('\n')[0].slice(0, 80) };
  }
  return { status: 'unknown' };
}

/**
 * 版本是否在本构建的支持线内：精确命中实测版本，或命中发布线正则。
 * 线外只警告不拒跑（拒绝只看 requireVersion 的探不出）——见 RuntimeVersionPolicy。
 */
export function versionIsSupported(policy: RuntimeVersionPolicy, version: string): boolean {
  if (policy.supportedVersions.includes(version)) return true;
  return policy.supportedVersionPattern?.test(version) ?? false;
}

/**
 * 版本门（对齐 OpenDesign 的版本策略语义，纯函数便于测试）：
 * - 无策略 = 旧语义：有输出即能跑，无输出但退出 0 也算
 * - requireVersion 且探不出/解析不出 → **fail-closed** 拒启
 * - 版本在线外 → 仍可用，但给 versionWarning
 */
export function versionGate(
  policy: RuntimeVersionPolicy | undefined,
  rawFirstLine: string | null,
  exitOk: boolean,
): { version: string | null; usable: boolean; warning?: string } {
  if (!policy) return { version: rawFirstLine, usable: rawFirstLine != null || exitOk };
  const version = rawFirstLine ? (policy.parse ? policy.parse(rawFirstLine) : rawFirstLine) : null;
  if (policy.requireVersion && !version) {
    return { version: null, usable: false, warning: '版本探不出来或无法解析，按版本策略拒启（宁可拒启也不带着错旗标跑）' };
  }
  if (version && !versionIsSupported(policy, version)) {
    return {
      version,
      usable: true,
      warning: `版本 ${version} 未验证（本构建实测 ${policy.supportedVersions.join('、')}${policy.supportedVersionPattern ? ' 所在发布线' : ''}）`,
    };
  }
  return { version, usable: true };
}

/**
 * 值拒绝探针执行（声明见 defs.ts 的 hiddenCapabilityFlags；判定规则见
 * capabilities.ts）。每个探针上下文 × 每个旗标一次 spawn，**并行**、空 stdin、
 * 限时、零 token——报错形状本身就是答案。
 */
async function probeHiddenCapabilities(def: RuntimeDefinition, target: SpawnTarget): Promise<Record<string, boolean>> {
  const spec = def.hiddenCapabilityFlags;
  if (!spec) return {};
  const caps: Record<string, boolean> = {};
  const probes = spec.probes.flatMap((probe) =>
    Object.entries(probe.flags).map(([flag, key]) => ({ probe, flag, key })));
  await Promise.all(probes.map(async ({ probe, flag, key }) => {
    const r = await spawnCapture(
      target.command,
      [...target.prefixArgs, ...probe.probeArgsPrefix, flag, HIDDEN_FLAG_PROBE_VALUE, ...(probe.probeArgsSuffix ?? [])],
      { timeoutMs: 10_000, input: '' },
    );
    caps[key] = classifyHiddenProbeOutput(`${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  }));
  return caps;
}

/**
 * 探测本机装了哪些 agent CLI。**异步并行**：一个 agent 的版本/登录/能力探针
 * 与各 agent 之间同时发——探测全是 CLI 冷启动（数秒级），串行 + spawnSync 曾把
 * GET 拖到 44 秒还冻住整个服务（2026-10-12 实测回归），探测绝不许阻塞事件循环。
 */
export async function detectRuntimes(candidates: RuntimeDefinition[] = RUNTIMES): Promise<DetectedRuntime[]> {
  return Promise.all(candidates.map(async (def): Promise<DetectedRuntime> => {
    let version: string | null = null;
    let usable = false;
    let versionWarning: string | undefined;
    let authStatus: DetectedRuntime['authStatus'];
    let authMessage: string | undefined;
    const target = resolveRuntimeTarget(def);
    const bin = target?.command ?? def.executable;
    const prefix = target?.prefixArgs ?? [];

    if (!target) return { def, version: null, usable: false, authMessage: undefined };

    // 三路探测并行发；版本门在收尾统一判（fail-closed 只看版本探不探得出）
    const [versionProbe, authProbe, hiddenCaps] = await Promise.all([
      spawnCapture(bin, [...prefix, ...def.probeArgs], { timeoutMs: 15_000 }),
      def.authProbe
        ? spawnCapture(bin, [...prefix, ...def.authProbe.args], { timeoutMs: def.authProbe.timeoutMs ?? 5_000 })
        : Promise.resolve(null),
      def.hiddenCapabilityFlags
        ? probeHiddenCapabilities(def, target)
        : Promise.resolve(null),
    ]);

    const text = `${versionProbe.stdout ?? ''}${versionProbe.stderr ?? ''}`.trim();
    // 版本串取第一行前 60 字符，避免把整段帮助文本带出去
    const rawLine = text ? text.split('\n')[0].trim().slice(0, 60) : null;
    const gate = versionGate(def.versionPolicy, rawLine, versionProbe.status === 0);
    version = gate.version;
    usable = gate.usable;
    versionWarning = gate.warning;

    if (usable && authProbe) {
      const cls = classifyAuth(authProbe.status, `${authProbe.stdout ?? ''}${authProbe.stderr ?? ''}`);
      authStatus = cls.status;
      authMessage = cls.message;
    }
    if (usable && hiddenCaps) setCapabilities(def.id, hiddenCaps);

    return { def, version, usable, versionWarning, authStatus, authMessage, target };
  }));
}
