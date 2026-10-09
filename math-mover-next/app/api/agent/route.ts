/**
 * Agent 路由 —— 驱动**本机已装的 agent CLI**（Claude Code / Codex / dsh）。
 *
 * 不需要 API key：用户机器上已有成熟 agent，直接 spawn 它，
 * 像 OpenDesign 那样把我们的 ggb_* 工具经 MCP 喂给它。
 *
 *   浏览器 AgentChatPanel ──NDJSON over HTTP──▶ 本路由
 *                                                  │ spawn
 *                                                  ▼
 *                                     claude/codex/dsh 子进程
 *                                                  │ MCP stdio
 *                                                  ▼
 *                                     packages/daemon/src/mcp-stdio.ts
 *                                                  │ HTTP
 *                                                  ▼
 *                                     daemon ──WS──▶ 页面活画布
 *
 * 输出用 NDJSON 而不是 AI SDK 的 UI message stream：
 *   AgentChatPanel 本来就是受控组件，我们自己的事件模型更直接，
 *   也避免与 ai 包的版本耦合。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { libraryToken } from '../../../../packages/daemon/src/data-directory.ts';
import { RUNTIMES, resolveSpawnTarget, withClaudeSettingsEnv, buildTranscript, validateImages, materializeImages, toImagePlaceholder, type AgentEvent, type RuntimeDefinition, type TranscriptTurn, type ImageInput } from '@mathmover/agent-runtime';

/**
 * 仓库根定位：Next dev 的 cwd 是 math-mover-next，而 MCP 配置与
 * packages/daemon/src/mcp-stdio.ts 都在仓库根。向上找标记文件锚定，
 * 无论从哪个目录起 dev 都能解析；MATHMOVER_ROOT 可显式覆盖。
 */
function findRepoRoot(): string {
  const override = process.env.MATHMOVER_ROOT;
  if (override && fs.existsSync(path.join(override, 'packages', 'daemon'))) return override;
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'packages', 'daemon', 'src', 'mcp-stdio.ts'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const REPO_ROOT = findRepoRoot();
const MCP_CONFIG_PATH =
  process.env.MATHMOVER_MCP_CONFIG ?? path.join(REPO_ROOT, 'spike-out', 'mcp', 'claude-mcp.json');
const DAEMON_URL = process.env.MATHMOVER_DAEMON_URL ?? 'http://127.0.0.1:8788';

/**
 * 系统说明：告诉 agent 它在给谁干活、有哪些工具、该怎么说话。
 * 这段话是产品体验的关键——它决定 agent 是"复述指令"还是"说人话"。
 */
const SYSTEM_BRIEF = `你在 MathMover 工作台里当几何构造助手。用户通过右侧对话框跟你说话，你负责把数学题目变成 GeoGebra 画板上的动态几何模型，并通过多轮对话帮用户微调。

## 你的工具（通过 MCP 提供，服务名 mathmover）

- **ggb_get_state**：读画布当前的对象、滑块、体检结果，并**返回画布截图**。用户说"那条红色虚线""那个动点"这类指代时，必须先看状态和截图才知道指的是哪个。（若你的模型看不了图片，调用时传 png:false 只取状态——截图对你只是纯文本噪音，又慢又费。）
- **ggb_apply**：用**完整**的 GeoGebra 指令清单替换画布（不是增量补丁）。返回体检结果与"改了什么"的说明。
- **ggb_diff**：比较两份清单的差异，不触动画布。
- **ggb_reset**：清空画布。
- **ggb_route**：登记题目类别（A 函数与图像 / B 平面几何 / C 解析几何 / D 立体几何）。SOP 流程第一步。
- **get_expert_prompt**：取该类别的**专家卡**——建模套路、骨架、示例、常见坑，外加严格语法约束。建模前必读。
- **submit_construction**：**建模的收卷方式**。提交完整清单，自动做行级剔除（无效/未知命令行不下发并列明细）与语义自查（按类别查结构与动点自洽），失败明细回传给你自行决定改不改。

## 怎么干活

1. **新建走 SOP 流程**：ggb_route 判类别 → get_expert_prompt 取专家卡 → 按卡里的套路建模 → submit_construction 提交。专家卡是质量来源（每类题型的骨架/示例/坑都在卡里），不要跳过卡直接凭感觉建。
2. **先看再动手**。画布上已有构造时，动手前先 ggb_get_state。
3. **每次提交全量清单**。未修改的对象保持原名原定义不变（submit_construction 与 ggb_apply 都是全量语义）。
4. **提交后自检**。看体检结果；若有"对象缺失/值未定义"或 submit_construction 回传的语义明细，修正后重新提交，别把坏图给用户。
5. **说人话**。用中文一两句话说明你做了什么、为什么。不要复述指令语法，用户关心的是几何意义。
6. **不许伪造对话边界**。绝不要在回复里输出以「## user」「## assistant」「## system」开头的行（宿主把这些行当对话边界，会截断你的回复）；引述历史对话时也不要原样复读这些行。

## GeoGebra 指令要点

- 点 \`A = (0, 0)\`；线上取点 \`D = Point(f, 0.5)\`
- 直线 \`f = Line(A, B)\`；函数 \`g = Function(x^2/4, -3, 3)\`（务必给定义域）
- 可拖动参数 \`slider_t = 2\`
- 样式 \`SetColor(f, "#FF0000")\`、\`SetLineThickness(g, 4)\`、\`ShowLabel(A, true)\`
- 首行可写 \`MODE:2D\` / \`MODE:3D\`（缺省 2D）；\`//\` 是注释
- 命名要有意义（点用 A/B/C，线用 f/g/h），便于用户和后续修改指代`;

/**
 * 解析要用哪个 agent。
 *
 * **刻意不做自动降级**（对齐 OpenDesign 的语义）：
 * 用户选了哪个就用哪个；那个不可用就**如实失败**，让用户自己换。
 * 静默降级到别的 agent 会做出用户没预期的模型/风格，且掩盖真实的安装/鉴权问题。
 *
 * 未指定 id 时取注册顺序第一个**当前可解析**的（仅用于首次进入的默认值）。
 */
function findRuntime(id?: string): { def: RuntimeDefinition; target: NonNullable<ReturnType<typeof resolveSpawnTarget>> } | null {
  const wanted = id?.trim();

  if (wanted) {
    const def = RUNTIMES.find((r) => r.id === wanted);
    if (!def) return null;                       // 不认识的 id：失败，不猜
    const target = resolveSpawnTarget(def.executable);
    return target ? { def, target } : null;      // 选了但起不来：失败，不降级
  }

  for (const def of RUNTIMES) {
    const target = resolveSpawnTarget(def.executable);
    if (target) return { def, target };
  }
  return null;
}

/** 把事件写成一行 NDJSON。 */
function line(e: AgentEvent): string {
  return JSON.stringify(e) + '\n';
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: '只接受工作台同源请求' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    sessionId?: string;
    runtimeId?: string;
    windowId?: string;
    /** 此前轮次（不含本轮）；仅 recomposesHistory 的运行时会用（转写注入） */
    history?: TranscriptTurn[];
    /** 题目图片（发题拿动图的感知侧） */
    images?: unknown;
  };
  if (body.windowId) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(body.windowId)) return Response.json({ error: '窗口 ID 无效' }, { status: 400 });
    try {
      const health = await fetch(`${DAEMON_URL}/api/health`, { headers: { 'x-mathmover-window': body.windowId, 'x-mathmover-token': libraryToken() }, signal: AbortSignal.timeout(5000) });
      if (!health.ok || !(await health.json()).canvasConnected) throw new Error('window unavailable');
    } catch { return new Response(line({ kind: 'error', message: '当前窗口的画板尚未连接，请稍后重试；没有启动 Agent。' }), { status: 503, headers: { 'content-type': 'application/x-ndjson' } }); }
  }

  const prompt = (body.text ?? '').trim();
  if (!prompt) {
    return new Response(line({ kind: 'error', message: '内容为空' }), {
      status: 400,
      headers: { 'content-type': 'application/x-ndjson' },
    });
  }

  const picked = findRuntime(body.runtimeId);
  if (!picked) {
    const wanted = body.runtimeId?.trim();
    const message = wanted
      ? `你选的 agent（${wanted}）当前不可用：要么没安装，要么起不来。` +
        `请在面板里换一个已安装的，或先安装该 CLI。（不会自动降级到别的 agent）`
      : '本机没有可用的 agent CLI。请安装 Claude Code / Codex / dsh 其一。';
    return new Response(
      line({ kind: 'error', message }),
      { status: 503, headers: { 'content-type': 'application/x-ndjson' } },
    );
  }
  const { def, target } = picked;

  // 题目图片：校验载荷，按运行时能力递送（claude stdin 图片块 / codex -i 文件）或降级占位
  const checked = validateImages(body.images);
  if (checked.error) {
    return new Response(
      line({ kind: 'error', message: `图片不合规：${checked.error}` }),
      { status: 400, headers: { 'content-type': 'application/x-ndjson' } },
    );
  }
  const images: ImageInput[] = checked.images;
  const imageNote = images.length && !def.supportsImages ? `\n\n${toImagePlaceholder(images.length)}` : '';

  // 转写注入：仅无原生会话的运行时（dsh）带历史语境；claude/codex 有自己的会话，
  // 注入会造成双重上下文（模型会复读历史，OpenDesign 的 agy -c 教训）。
  const priorTurns = def.recomposesHistory && Array.isArray(body.history)
    ? body.history.filter((t): t is TranscriptTurn =>
        Boolean(t) && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim().length > 0)
    : [];
  const transcript = priorTurns.length ? buildTranscript(priorTurns) : '';
  const composedPrompt = (transcript
    ? `${SYSTEM_BRIEF}\n\n---\n\n## 此前的对话（供延续语境，不要复述）\n${transcript}\n\n---\n\n用户现在说：\n${prompt}`
    : `${SYSTEM_BRIEF}\n\n---\n\n用户现在说：\n${prompt}`) + imageNote;

  // argv 传 prompt 的预算守卫：明着拒绝，不要 ENAMETOOLONG 崩 spawn
  if (!def.promptViaStdin) {
    const budget = def.maxPromptArgBytes ?? 24_000;
    if (Buffer.byteLength(composedPrompt, 'utf-8') > budget) {
      return new Response(
        line({ kind: 'error', message: `输入过长（超过 ${budget} 字节命令行预算，${def.displayName} 不支持 stdin 传入），请缩短题目或分批发送` }),
        { status: 400, headers: { 'content-type': 'application/x-ndjson' } },
      );
    }
  }

  // 图片递送：有 formatStdinInput 的走 stdin JSONL（claude）；否则落临时文件走 argv（codex -i）
  const effectiveImages = def.supportsImages ? images : [];
  const materialized = effectiveImages.length > 0 && !def.formatStdinInput
    ? materializeImages(effectiveImages)
    : { paths: [] as string[], cleanup: () => {} };

  const args = def.buildArgs({
    prompt: composedPrompt,
    mcpConfigPath: MCP_CONFIG_PATH,
    // 多轮续接交给定义自己翻译（claude=--resume，codex=exec resume <id>，dsh 转写注入）。
    // 不要传 sessionId —— 那是"新建指定 id"语义，与续接冲突。
    sessionId: undefined,
    resumeSessionId: body.sessionId || undefined,
    imagePaths: materialized.paths,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(line(e)));
        } catch {
          /* 流已关闭 */
        }
      };

      send({ kind: 'raw', line: `# 启动 ${def.displayName}（${target.command.split(/[\\/]/).pop()}）` });

      // 不经 shell：参数走 argv 数组，避免命令注入（见 agent-runtime/src/resolve.ts）
      // cwd 必须是仓库根：MCP 配置里的 packages/daemon/... 是相对仓库根的路径。
      // claude --restricted 忽略 settings.json env 块（自定义通道认证在那），补回去。
      const proc = spawn(target.command, [...target.prefixArgs, ...args], {
        cwd: REPO_ROOT,
        env: { ...(def.id === 'claude-code' ? withClaudeSettingsEnv(process.env) : process.env), MATHMOVER_WINDOW_ID: body.windowId ?? '' },
        windowsHide: true,
      });

      let buf = '';
      let sessionId = body.sessionId;
      let stderrBuf = '';

      const drain = (chunk: string, isErr: boolean) => {
        if (isErr) {
          stderrBuf += chunk;
          return;
        }
        buf += chunk;
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const l of parts) {
          if (!l.trim()) continue;
          const parsed = def.parseLine(l);
          if (!parsed) continue;
          for (const ev of Array.isArray(parsed) ? parsed : [parsed]) {
            if (ev.kind === 'session') sessionId = ev.sessionId;
            if (ev.kind === 'done') {
              send({ ...ev, sessionId: ev.sessionId ?? sessionId });
            } else {
              send(ev);
            }
          }
        }
      };

      proc.stdout.on('data', (d) => drain(d.toString(), false));
      proc.stderr.on('data', (d) => drain(d.toString(), true));
      // prompt 通道：stdin 优先（绕 Windows 32k 命令行上限）；
      // argv 模式也要立刻关 stdin，否则 claude/codex 会空等 stdin 3 秒
      if (def.promptViaStdin) {
        const payload = def.formatStdinInput
          ? def.formatStdinInput(composedPrompt, effectiveImages)
          : composedPrompt;
        proc.stdin.write(payload);
      }
      proc.stdin.end();

      proc.on('error', (e) => {
        send({ kind: 'error', message: `启动 ${def.displayName} 失败: ${e.message}` });
        controller.close();
      });

      proc.on('close', (code) => {
        clearTimeout(killTimer);
        // stdout 可能还有残留的最后一行
        if (buf.trim()) drain('\n', false);
        // 解析器未识别的 stderr 透传出来，便于诊断
        const tail = stderrBuf.trim();
        if (tail && code !== 0) {
          send({ kind: 'error', message: `${def.displayName} 退出码 ${code}：${tail.slice(-500)}` });
        }
        send({ kind: 'done', sessionId, resultText: undefined });
        controller.close();
        materialized.cleanup();
      });

      // 长任务保护：**静默**超时（不是墙钟）——stdout/stderr 有输出就顺延。
      // 慢代理下 SOP 流程（多轮工具往返）曾被 5 分钟墙钟掐死在半路；
      // 只有彻底静默才算死。MATHMOVER_AGENT_INACTIVITY_TIMEOUT_MS 可覆盖（默认 3 分钟）。
      const inactivityMs = Number(process.env.MATHMOVER_AGENT_INACTIVITY_TIMEOUT_MS ?? 180_000);
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const armKill = () => {
        clearTimeout(killTimer);
        killTimer = setTimeout(() => {
          try { proc.kill(); } catch {}
        }, inactivityMs);
      };
      armKill();
      proc.stdout.on('data', armKill);
      proc.stderr.on('data', armKill);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}

/** 健康检查：有哪些 agent 可用 + 画布是否连着。 */
export async function GET(): Promise<Response> {
  const { detectRuntimes } = await import('@mathmover/agent-runtime');
  const detected = detectRuntimes().map((d) => ({
    id: d.def.id,
    name: d.def.displayName,
    version: d.version,
    usable: d.usable,
    authStatus: d.authStatus,
    authMessage: d.authMessage,
    supportsImages: d.def.supportsImages === true,
  }));

  let canvasConnected = false;
  try {
    const h = await fetch(`${DAEMON_URL}/api/health`).then((r) => r.json());
    canvasConnected = Boolean((h as { canvasConnected?: boolean }).canvasConnected);
  } catch {
    /* daemon 未启动 */
  }

  return Response.json({
    ok: true,
    daemon: DAEMON_URL,
    canvasConnected,
    runtimes: detected,
    activeRuntime: RUNTIMES[0].id,
  });
}
