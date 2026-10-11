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

import fs from 'node:fs';
import path from 'node:path';
import { libraryToken } from '../../../../packages/daemon/src/data-directory.ts';
import { RUNTIMES, runAgent, resolveSpawnTarget, buildTranscript, validateImages, listAgentModels, resolveModel, type AgentEvent, type RuntimeDefinition, type TranscriptTurn } from '@mathmover/agent-runtime';
import { agentRequestHistory } from '@/lib/agent-request-history';

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
  process.env.MATHMOVER_MCP_CONFIG ?? path.join(REPO_ROOT, 'packages', 'daemon', 'mcp', 'claude-mcp.json');
const DAEMON_URL = process.env.MATHMOVER_DAEMON_URL ?? 'http://127.0.0.1:8788';

/**
 * 系统说明：告诉 agent 它在给谁干活、有哪些工具、该怎么说话。
 * 这段话是产品体验的关键——它决定 agent 是"复述指令"还是"说人话"。
 */
const SYSTEM_BRIEF = `你在 MathMover 工作台里当 GeoGebra 画图助手。

**这是「AI 辅助画 GeoGebra 动图」的工作台**——卖点是精确、可控：靠你把用户意图稳定地变成合法的 GeoGebra 构造，而不是让他自己去拼指令。用户通过右侧对话框跟你说话，平时多半是让你画图、改图。

有时用户会发**题目图片/题面**，让你把题目变成动图。那是本产品需求最大的场景，但它是一条**链路**，不是产品本身——**别把每次对话都当成做题**。

## 你的工具（通过 MCP 提供，服务名 mathmover）

- **ggb_get_state**：读画布当前的对象、滑块、体检结果，并**返回画布截图**。用户说"那条红色虚线""那个动点"这类指代时，必须先看状态和截图才知道指的是哪个。（若你的模型看不了图片，调用时传 png:false 只取状态——截图对你只是纯文本噪音，又慢又费。）
- **ggb_apply**：用**完整**的 GeoGebra 指令清单替换画布（不是增量补丁）。返回体检结果与"改了什么"的说明。
- **ggb_diff**：比较两份清单的差异，不触动画布。
- **ggb_reset**：清空画布。
- **get_drawing_pack**：**自由画图从这里开始**。取画图基础包（公共约定 + 每题必用的 GGB 通用写法 + 严格语法约束）与**全库写法卡清单**（不按类别裁剪）。
- **get_expert_prompt**：**题图→GeoGebra 专用**。取 A/B/C/D 专家的 8 步建模流程 + 本类写法卡清单。**题目属于哪一类由你判**（A 函数与图像 / B 平面几何 / C 解析几何 / D 立体几何），调它时把类别一并给出；判错了换个类别再调一次即可覆盖。
- **get_sop_cards**：按名字批量取写法卡正文（具体指令写法、示例、易错点）。清单只是目录，**写到哪步不确定怎么写就取卡，不要凭记忆编指令**。
- **submit_construction**：**收卷方式**。提交完整清单，自动做行级剔除（无效/未知命令行不下发并列明细）与语义自查（动点自洽；做题时另查类别结构），失败明细回传给你自行决定改不改。**顺带给 title**——8 字以内，**概括用户第一条消息要做什么**（不是概括你画成了什么；标题命名「请求」，多轮微调后也不该变）。如「画个抛物线，焦点(1,0)，再画过焦点的直线」→「抛物线与过焦点直线」。它会当课件名显示。

## 怎么干活

**先分清是哪种活：**

1. **发了题目图片/题面 → 做题**：判题目类别 → get_expert_prompt 取 8 步流程与本类清单（类别一并给出）→ 按流程建模 → submit_construction 提交（**给 category**，会多查类别结构；**给 title**）。
2. **让你画图/改图 → 自由画图**：get_drawing_pack 取基础包与全库清单 → 按需取卡 → submit_construction 提交（**不要给 category**，硬套题目类别只会得到无关告警；**给 title**）。

两种活共同的规矩：

3. **先看再动手**。画布上已有构造时，动手前先 ggb_get_state。
4. **不确定的写法用 get_sop_cards 取卡照抄**，不要凭印象编指令；也不要把清单里没用到的卡整批拉下来。
5. **每次提交全量清单**。未修改的对象保持原名原定义不变（submit_construction 与 ggb_apply 都是全量语义）。
6. **提交后自检**。看体检结果；若有"对象缺失/值未定义"或 submit_construction 回传的语义明细，修正后重新提交，别把坏图给用户。
7. **说人话**。用中文一两句话说明你做了什么、为什么。不要复述指令语法，用户关心的是几何意义。
8. **不许伪造对话边界**。绝不要在回复里输出以「## user」「## assistant」「## system」开头的行（宿主把这些行当对话边界，会截断你的回复）；引述历史对话时也不要原样复读这些行。

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
    /** An edited turn starts a fresh native session using only the retained conversation. */
    restartFromHistory?: boolean;
    runtimeId?: string;
    /** 本次要用的模型 id。不传 = 用 CLI 自己的配置。UI 的模型选择器填这里。 */
    model?: string;
    /** 推理档位（该模型 reasoningOptions 之一）。只对支持的运行时生效。 */
    reasoningEffort?: string;
    windowId?: string;
    /** 此前轮次（不含本轮）；用于无会话运行时或编辑后的新会话。 */
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

  // 模型：先跑一次发现（把 live 清单记进缓存），再校验用户的选择。
  // 不校验会出现「UI 显示了一个模型，实际跑不了」——fallbackModels 只是提示，
  // 不是真清单（见 agent-runtime/src/models.ts）。
  let model: string | undefined;
  if (typeof body.model === 'string' && body.model.trim()) {
    await listAgentModels(def, target).catch(() => null);
    const resolved = resolveModel(def.id, body.model, { supportsCustomModel: def.supportsCustomModel });
    if (!resolved.ok) {
      return new Response(
        line({ kind: 'error', message: resolved.reason }),
        { status: 400, headers: { 'content-type': 'application/x-ndjson' } },
      );
    }
    model = resolved.model;
  }

  // 题目图片：这里只校验载荷。递送通道分流、prompt 说明、argv 预算守卫都归
  // agent-runtime 的 runAgent（见 src/run.ts）——本层是 HTTP，只把事件转成 NDJSON 流。
  const checked = validateImages(body.images);
  if (checked.error) {
    return new Response(
      line({ kind: 'error', message: `图片不合规：${checked.error}` }),
      { status: 400, headers: { 'content-type': 'application/x-ndjson' } },
    );
  }

  // Only fresh edited native sessions need a retained transcript. Resumed sessions
  // already own their history and must not receive duplicate context.
  const priorTurns = agentRequestHistory(body, def.recomposesHistory);
  const transcript = priorTurns.length ? buildTranscript(priorTurns) : '';
  const composedPrompt = transcript
    ? `${SYSTEM_BRIEF}\n\n---\n\n## 此前的对话（供延续语境，不要复述）\n${transcript}\n\n---\n\n用户现在说：\n${prompt}`
    : `${SYSTEM_BRIEF}\n\n---\n\n用户现在说：\n${prompt}`;

  // 流建立前到的事件先排队（runAgent 启动时就会吐「# 启动 …」）
  const queued: AgentEvent[] = [];
  let sink: (e: AgentEvent) => void = (e) => queued.push(e);

  const handle = runAgent({
    def,
    prompt: composedPrompt,
    mcpConfigPath: MCP_CONFIG_PATH,
    cwd: REPO_ROOT,
    // 不要传 sessionId —— 那是"新建指定 id"语义，与续接冲突
    resumeSessionId: body.sessionId || undefined,
    images: checked.images,
    model,
    reasoningEffort: typeof body.reasoningEffort === 'string' && body.reasoningEffort.trim()
      ? body.reasoningEffort.trim().slice(0, 32) : undefined,
    env: { MATHMOVER_WINDOW_ID: body.windowId ?? '' },
    // 长任务保护：**静默**超时（不是墙钟），见 run.ts
    inactivityTimeoutMs: Number(process.env.MATHMOVER_AGENT_INACTIVITY_TIMEOUT_MS ?? 180_000),
    onEvent: (e) => sink(e),
  });

  // 拒启（如 prompt 超 argv 预算）：明着 400，不要拿 200 + 流内错误糊弄
  if (!handle.proc) {
    const first = queued.find((e) => e.kind === 'error');
    return new Response(
      line({ kind: 'error', message: first?.kind === 'error' ? first.message : `启动 ${def.displayName} 被拒绝` }),
      { status: 400, headers: { 'content-type': 'application/x-ndjson' } },
    );
  }
  void target; // 仅用于 findRuntime 的可用性预检，真正 spawn 由 runAgent 负责

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
      for (const e of queued.splice(0)) send(e);
      sink = send;
      handle.done.then(
        () => { try { controller.close(); } catch { /* 已关闭 */ } },
        () => { try { controller.close(); } catch { /* 已关闭 */ } },
      );
    },
    cancel() {
      try { handle.cancel(); } catch { /* 已退出 */ }
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
  const { detectRuntimes, listAgentModels } = await import('@mathmover/agent-runtime');
  const detected = await Promise.all(detectRuntimes().map(async (d) => {
    // 模型清单：能用的才探（claude/codex 读配置文件，很快；有 listModels 的才 spawn）。
    // 探失败不影响运行时本身可用——只是模型下拉没得选。
    let models: { list: Array<{ id: string; label: string }>; source: string } | undefined;
    if (d.usable) {
      try {
        const listing = await listAgentModels(d.def, d.target ?? d.def.executable);
        models = { list: listing.models, source: listing.source };
      } catch { /* 不带模型清单，前端据 hides 控件 */ }
    }
    return {
      id: d.def.id,
      name: d.def.displayName,
      version: d.version,
      usable: d.usable,
      authStatus: d.authStatus,
      authMessage: d.authMessage,
      canAttachImages: d.def.imageDelivery != null,
      supportsCustomModel: d.def.supportsCustomModel !== false,
      models,
    };
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
