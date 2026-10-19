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
import { libraryToken, dataDirectory } from '../../../../packages/daemon/src/data-directory.ts';
import { RUNTIMES, runAgent, opencode, buildOpenCodeConfigContent, effectiveReasoningLevels, normalizeReasoningLevels, reasoningDialect, OPENCODE_BYOK_API_KEY_ENV, resolveRuntimeTarget, resumesSession, buildTranscript, validateImages, listAgentModels, resolveModel, resolveEffort, createTitleExtractor, type AgentEvent, type RuntimeDefinition, type TranscriptTurn } from '@mathmover/agent-runtime';
import { agentRequestHistory } from '@/lib/agent-request-history';
import { loadByokConfig, isByokRunnable, maskByokConfig } from '@/lib/byok-store';
import { fetchByokModels } from '@/lib/byok-probe';
import { buildSystemBrief } from '@/lib/server/system-brief';
import { readFreshDetectionCache, writeDetectionCache, type DetectedRuntime } from '@/lib/server/detection-cache';
import { constructionPath, ensureConstructionDraft, ensureMcpConfig, workspaceDir } from '@/lib/server/workspace';

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
 * 首轮的标题指令 —— 拼在稳定前缀**之后**的每轮切片里，只发一次。
 *
 * 课件名走正文标记（`<mm-title>`），宿主剥掉、用户看不见；见 agent-runtime 的
 * title-marker.ts。为什么不用工具参数：`ggb_apply` 是「每完成一段就调一次」的高频动作，
 * 标题挂上去就得反复重说；而且某轮 agent 一次工具都没调时，标题永远拿不到。
 */
const TITLE_DIRECTIVE =
  '【这一轮额外做一件事】在正常回答之前，先在正文最前面输出一次标题标记：\n' +
  '<mm-title>标题</mm-title>\n' +
  '规则：2–8 字；**概括用户这条消息要做什么**（不是概括你画成了什么——标题命名的是「请求」，' +
  '多轮微调后也不该变）；用用户的语言；不要引号、不要 markdown、不要结尾标点。' +
  '输出完标记就直接开始正常回答，不要向用户提这件事。';


/**
 * 解析要用哪个 agent。
 *
 * **刻意不做自动降级**（对齐 OpenDesign 的语义）：
 * 用户选了哪个就用哪个；那个不可用就**如实失败**，让用户自己换。
 * 静默降级到别的 agent 会做出用户没预期的模型/风格，且掩盖真实的安装/鉴权问题。
 *
 * 未指定 id 时取注册顺序第一个**当前可解析**的（仅用于首次进入的默认值）。
 */
function findRuntime(id?: string): { def: RuntimeDefinition; target: NonNullable<ReturnType<typeof resolveRuntimeTarget>> } | null {
  const wanted = id?.trim();

  if (wanted) {
    const def = RUNTIMES.find((r) => r.id === wanted);
    if (!def) return null;                       // 不认识的 id：失败，不猜
    const target = resolveRuntimeTarget(def);    // 主可执行名 + fallbackBins 分叉兼容
    return target ? { def, target } : null;      // 选了但起不来：失败，不降级
  }

  for (const def of RUNTIMES) {
    const target = resolveRuntimeTarget(def);
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
    /**
     * 本轮的课件 id。agent 的工作稿目录按它落（`workspaces/<课件id>/`）——
     * 草稿是「当前画布的可编辑形态」，归课件所有，不跟窗口走。缺省落 `_default`。
     */
    coursewareId?: string;
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
  // 课件 id 决定 agent 的工作稿目录，形态必须干净（它要当目录名）。
  if (body.coursewareId && !/^[a-zA-Z0-9_-]{1,100}$/.test(body.coursewareId)) {
    return Response.json({ error: '课件 ID 无效' }, { status: 400 });
  }

  const prompt = (body.text ?? '').trim();
  // 纯图发题是自然动作：只附图片、不打字也放行（图片校验在后，细节错在这里之后拦）。
  const hasImages = Array.isArray(body.images) && body.images.length > 0;
  if (!prompt && !hasImages) {
    return new Response(line({ kind: 'error', message: '内容为空' }), {
      status: 400,
      headers: { 'content-type': 'application/x-ndjson' },
    });
  }

  // 内置 Agent（OpenCode）：与我们自带的 runtime 跑，**不需要本机 agent CLI**。
  // 与三条 CLI 的唯一区别是「定义从哪来」——端点/密钥/模型来自**应用数据目录的
  // 配置仓**（key 由本机应用保管、完整值永不回传界面），请求体不再携带。
  const isBuiltin = body.runtimeId === 'byok';
  const builtinCfg = isBuiltin ? loadByokConfig(dataDirectory()) : null;
  if (isBuiltin && !isByokRunnable(builtinCfg)) {
    return new Response(
      line({ kind: 'error', message: '内置 Agent 尚未配置：请在设置里填写 API 端点与模型。' }),
      { status: 400, headers: { 'content-type': 'application/x-ndjson' } },
    );
  }

  const picked = isBuiltin ? null : findRuntime(body.runtimeId);
  if (!picked && !isBuiltin) {
    const wanted = body.runtimeId?.trim();
    const message = wanted
      ? `你选的 agent（${wanted}）当前不可用：要么没安装，要么起不来。` +
        `请在面板里换一个已安装的，或先安装该 CLI。（不会自动降级到别的 agent）`
      : '本机没有可用的 agent CLI。请安装 Claude Code / Codex / dsh 其一，或在设置里配置内置 Agent。';
    return new Response(
      line({ kind: 'error', message }),
      { status: 503, headers: { 'content-type': 'application/x-ndjson' } },
    );
  }
  // 内置位用我们自带的定义（与本机 CLI 走**同一条** spawn 通路）。
  // 走到这里必有其一：picked 命中，或就是内置位。
  const def: RuntimeDefinition = picked ? picked.def : opencode;
  const target = picked?.target;

  // 模型：三条 CLI 只查 GET 健康检查已发现的 liveModels 缓存（不再 spawn CLI）；
  // 内置位的模型在设置表单里，不走清单校验（provider 前缀由定义自己加）。
  let model: string | undefined;
  let effort = typeof body.reasoningEffort === 'string' && body.reasoningEffort.trim()
    ? body.reasoningEffort.trim().slice(0, 32) : undefined;
  if (picked) {
    if (typeof body.model === 'string' && body.model.trim()) {
      const resolved = resolveModel(def.id, body.model);
      if (!resolved.ok) {
        return new Response(
          line({ kind: 'error', message: resolved.reason }),
          { status: 400, headers: { 'content-type': 'application/x-ndjson' } },
        );
      }
      model = resolved.model;
    }
    if (effort) {
      const checked = resolveEffort(def.id, model ?? 'default', effort);
      if (!checked.ok) {
        return new Response(
          line({ kind: 'error', message: checked.reason }),
          { status: 400, headers: { 'content-type': 'application/x-ndjson' } },
        );
      }
    }
  } else if (builtinCfg) {
    // 合成器里选的模型优先（那份清单就是同一个端点的真清单，见 GET）；
    // 没选、或选了哨兵「默认」，就用设置里配的那个。
    const pickedModel = typeof body.model === 'string' ? body.model.trim() : '';
    model = pickedModel && pickedModel !== 'default' ? pickedModel : builtinCfg.model;
    // 档位：只认**设置里手填过的那份清单**里的值（不自造档位），且**该格式得有档位方言**
    // ——Anthropic/Gemini 下这个字段会被 provider 丢掉，传了也是骗人（见 REASONING_DIALECTS）。
    const levels = reasoningDialect(builtinCfg.apiFormat)
      ? effectiveReasoningLevels(builtinCfg.reasoningLevels)
      : [];
    effort = levels.includes(effort ?? '') ? effort : undefined;
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
  // 图片能不能送达由 runAgent 按 def 的 imageDelivery 分流（没有通道时它会在
  // prompt 里如实说明「未送达」）——本层不再替它判死，内置位与三条 CLI 同规则。


  // Only fresh edited native sessions need a retained transcript. Resumed sessions
  // already own their history and must not receive duplicate context.
  // resumesSession() 闸双重上下文（OpenDesign agy -c 教训）：即使某个 def 误把
  // recomposesHistory 和原生会话同时打开，也绝不注入转写。
  const priorTurns = agentRequestHistory(body, def.recomposesHistory === true && !resumesSession(def));
  const transcript = priorTurns.length ? buildTranscript(priorTurns) : '';
  // 纯图发题（没打字）：不伪造用户话语，如实说只发了图片。
  const userTurn = prompt || '（只发了题目图片，没写文字——请直接看图理解题意并作图）';

  // 简报只发首轮（对齐 OpenDesign 的 request / continuation 二分）：
  //  真会话续接时模型自带上一轮的简报——再发一遍会在上下文里累积多份，
  //  每轮都重读，越聊越贵。内置位（OpenCode）也有原生会话，同一条规则。
  const isContinuation = Boolean(body.sessionId);
  const head = isContinuation ? '' : buildSystemBrief(REPO_ROOT);

  // 工作稿路径**按课件而异**（`<dataDir>/workspaces/<课件id>/`），不进稳定简报——
  // 那会破坏 cache 前缀。单起一行、每轮都带：体积小，而 agent 每次动笔都要它。
  // 实测没说清时会满仓库找位置，一次白烧 12 次工具调用。
  // 无课件 id 时落 `_default`（workspaceDir 的兜底），与 daemon 同一套规则。
  const coursewareKey = body.coursewareId?.trim() || undefined;
  const sandbox = workspaceDir(coursewareKey);
  // 空工作稿先建好：agent 会「先读再改」，新课件没有这份文件时它第一轮就吃一个 Read 失败
  //（实测白烧一次工具调用 + 用户看到一条"工具返回错误"）。已有草稿不会被覆盖。
  ensureConstructionDraft(coursewareKey);
  const pathLine = `工作稿路径：${constructionPath(coursewareKey)}（写构造就写进这个绝对路径，别处写的 daemon 读不到）`;

  // 首轮 = 既没有前序轮次，也没有可续的原生会话。编辑历史轮次（restartFromHistory）带着
  // 前序，不算首轮——那种轮次不该重新命名课件。
  const isFirstTurn = priorTurns.length === 0 && !body.sessionId;

  const parts: string[] = [];
  if (head) parts.push(head);
  // 标题指令**只在首轮**、且拼在稳定前缀**之后**（每轮切片）。
  // 塞进稳定前缀有两个坏处：① 每轮都要求生成标题（模型会每轮自作主张吐标记）；
  // ② 移动缓存前缀，每轮都 miss（OpenDesign 为此专门把同类指令放切片里，注释写明过）。
  // 稳定规则段里另有一句「只在被明确要求时才输出标记」，管住不自作主张。
  if (isFirstTurn) parts.push(TITLE_DIRECTIVE);
  if (transcript) parts.push(`## 此前的对话（供延续语境，不要复述）\n${transcript}`);
  parts.push(`${pathLine}\n\n用户现在说：\n${userTurn}`);
  const composedPrompt = parts.join('\n\n---\n\n');

  // 流建立前到的事件先排队（runAgent 启动时就会吐「# 启动 …」）
  const queued: AgentEvent[] = [];
  let sink: (e: AgentEvent) => void = (e) => queued.push(e);

  let handle: {
    done: Promise<{ exitCode: number | null; sessionId?: string }>;
    cancel: () => void;
    proc: unknown;
  };
  // 内置位的 provider/MCP 注入走 OPENCODE_CONFIG_CONTENT（**不**写用户的全局配置；
  // 没有内容时它是 null，此时不动这个环境变量）。密钥另走一个环境变量、配置里
  // 用 {env:…} 引用——不落文件也不进 argv。
  const opencodeConfig = isBuiltin && builtinCfg
    ? buildOpenCodeConfigContent({
        // ⚠ 声明的必须是**这一轮真正要跑的那个模型**（合成器里可能换过），
        // 不是设置里存的那个——声明错了 opencode 会找不到模型。
        // 档位同理：variants 要挂在同一个模型条目上。
        provider: {
          baseUrl: builtinCfg.baseUrl,
          model: model ?? builtinCfg.model,
          apiKey: builtinCfg.apiKey,
          apiFormat: builtinCfg.apiFormat,
          reasoningLevels: reasoningDialect(builtinCfg.apiFormat)
            ? effectiveReasoningLevels(builtinCfg.reasoningLevels)
            : [],
        },
        // 与 ensureMcpConfig 同一份实体：同一个 node、同一个 mcp-stdio 入口、同一个 daemon 地址。
        mcp: {
          command: process.execPath,
          args: [path.join(REPO_ROOT, 'packages', 'daemon', 'src', 'mcp-stdio.ts')],
          env: { MATHMOVER_DAEMON_URL: DAEMON_URL },
        },
      })
    : null;
  handle = runAgent({
    def,
    prompt: composedPrompt,
    // 沙箱 = 数据目录下的工作区：claude 的 --restricted 把写入框在 cwd 里、
    // opencode 的 --dir 同此（且它不认进程 cwd，必须显式给），工作稿必须在里面，
    // 而用户数据要归数据目录、软件要归软件（别把工作稿塞进仓库目录换解 bug）。
    mcpConfigPath: ensureMcpConfig(REPO_ROOT, DAEMON_URL),
    cwd: sandbox,
    // 不要传 sessionId —— 那是"新建指定 id"语义，与续接冲突
    resumeSessionId: body.sessionId || undefined,
    images: checked.images,
    model,
    reasoningEffort: effort,
    env: {
      MATHMOVER_WINDOW_ID: body.windowId ?? '',
      MATHMOVER_COURSEWARE_ID: coursewareKey ?? '',
      ...(opencodeConfig ? { OPENCODE_CONFIG_CONTENT: opencodeConfig } : {}),
      ...(opencodeConfig && builtinCfg?.apiKey.trim()
        ? { [OPENCODE_BYOK_API_KEY_ENV]: builtinCfg.apiKey.trim() }
        : {}),
    },
    // 长任务保护：**静默**超时与**首输出**硬顶（语义见 run.ts / defs.ts）。
    // per-agent 推荐值在定义上，环境变量仍优先（运维要压测时不用改代码）。
    inactivityTimeoutMs: Number(process.env.MATHMOVER_AGENT_INACTIVITY_TIMEOUT_MS ?? def.inactivityTimeoutMs ?? 180_000),
    firstOutputTimeoutMs: Number(process.env.MATHMOVER_AGENT_FIRST_OUTPUT_TIMEOUT_MS ?? def.firstOutputTimeoutMs ?? 0),
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
  // 标题标记在这里剥掉——CLI 与 BYOK 都从这儿出流，一处管两家。
  // **剥离恒开**（标记是协议噪音，任何情况下都不许进正文），采用只认本轮第一个。
  const titleExtractor = createTitleExtractor();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(line(e)));
        } catch {
          /* 流已关闭 */
        }
      };
      // 队列里的事件也要过提取器（流建立前 runAgent 就会吐事件）
      const send = (e: AgentEvent) => {
        for (const out of titleExtractor.push(e)) write(out);
      };
      for (const e of queued.splice(0)) send(e);
      sink = send;
      const finish = () => {
        // 流尾可能残留半截开标签前缀（正文结尾就写了个 `<`）——吐出来，别丢字
        for (const out of titleExtractor.flush()) write(out);
        try { controller.close(); } catch { /* 已关闭 */ }
      };
      handle.done.then(finish, finish);
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
export async function GET(req: Request): Promise<Response> {
  const { detectRuntimes, listAgentModels } = await import('@mathmover/agent-runtime');
  const fresh = new URL(req.url).searchParams.has('fresh');
  // 缓存放 lib/server/detection-cache.ts：`/api/byok` 保存后要作废它，
  // 否则配置变了 60 秒内重开页面还是旧清单。
  let runtimes = fresh ? null : readFreshDetectionCache();
  if (!runtimes) {
    // 清单发现与探测**并行**发：两边都含 CLI 冷启动（秒级），串行会让墙钟翻倍
    // （实测 14s → 并行后≈单阶段）。探失败不影响运行时本身可用——只是没得选。
    const listingPromises = new Map(RUNTIMES.map((def) => [def.id,
      listAgentModels(def, resolveRuntimeTarget(def) ?? def.executable).catch(() => null)]));
    // 内置位的模型清单也**同时**发：它是一次对端点的网络请求（超时 8s），
    // 串在 CLI 冷启动后面会白等一轮（实测整条 GET 因此从 ~4s 涨到 ~11s）。
    const byokRaw = loadByokConfig(dataDirectory());
    const byokModelsPromise = isByokRunnable(byokRaw)
      ? fetchByokModels(byokRaw!, fetch, { allPages: false }).catch(() => null)
      : Promise.resolve(null);
    const runs = await detectRuntimes();
    // 显式宽类型：BYOK 合成条目不在 def 的字面量 id 联合里
    const detected: DetectedRuntime[] = await Promise.all(runs.map(async (d) => {
      let models: { list: Array<{ id: string; label: string }>; source: string } | undefined;
      if (d.usable) {
        const listing = await listingPromises.get(d.def.id);
        if (listing) models = { list: listing.models, source: listing.source };
      }
      return {
        id: d.def.id,
        name: d.def.displayName,
        version: d.version,
        usable: d.usable,
        versionWarning: d.versionWarning,
        authStatus: d.authStatus,
        authMessage: d.authMessage,
        canAttachImages: d.def.imageDelivery != null,
        models,
      };
    }));
    // 内置 Agent：**运行时不依赖本机 CLI**（随应用自带），但那份二进制缺失时要如实
    // 报出来——选择器说「可用」而真跑起来 spawn 失败才是最糟的形态。
    // **id 保持 'byok'**：设置仓、已存偏好、前端的 runtimeId 都不用动，换个标签就够了。
    const byokView = maskByokConfig(byokRaw);
    const builtinBinary = resolveRuntimeTarget(opencode);
    const builtinReady = Boolean(builtinBinary) && isByokRunnable(byokRaw);
    // 模型清单：取**端点上的真清单**（与设置页「获取模型列表」同一份数据、同一个探针）。
    // 为什么必须给真清单：合成器的模型选择器要求「>1 个选项」才渲染，只给一条
    // 「默认」时它整块藏起来——内置位看起来就是"没有模型可选"（2026-10-18 用户报的）。
    // 取不到就退回单条默认：如实说"由设置决定"，**不编假模型**。
    // 档位：**挂在模型上**（合成器与设置页都从选中模型取），所以每个模型条目都带上
    // 同一份清单——档位清单是端点级的，不随模型变。两处都不给假数据：
    // 没填、或该格式根本没有档位方言（Anthropic/Gemini）→ 留空，合成器会如实显示
    // 「由 Agent 配置决定」，而不是给一个点了没反应的控件。
    const levels = reasoningDialect(byokRaw?.apiFormat)
      ? effectiveReasoningLevels(byokRaw?.reasoningLevels ?? '')
      : [];
    const reasoningOptions = levels.map((id) => ({ id, label: id }));
    let builtinModels: { list: Array<{ id: string; label: string; reasoningOptions?: typeof reasoningOptions }>; source: 'live' | 'fallback' } =
      { list: [{ id: 'default', label: '默认（用设置里配置的模型）' }], source: 'fallback' };
    if (builtinReady && byokRaw) {
      const listed = await byokModelsPromise;
      if (listed?.ok && listed.models?.length) {
        // 设置里已配好的那个**始终在列**——端点清单里没有它（改过名/私有部署）时
        // 也不能让用户选不回来。
        const list = [...listed.models];
        if (byokRaw.model && !list.some((m) => m.id === byokRaw.model)) {
          list.unshift({ id: byokRaw.model, label: `${byokRaw.model}（设置里配置的）` });
        }
        builtinModels = { list, source: 'live' };
      }
    }
    if (reasoningOptions.length) {
      builtinModels = { ...builtinModels, list: builtinModels.list.map((m) => ({ ...m, reasoningOptions })) };
    }
    detected.push({
      id: 'byok',
      name: '内置 Agent（OpenCode）',
      version: builtinBinary ? '自带 runtime · 无需安装' : '自带 runtime 缺失',
      usable: Boolean(builtinBinary),
      versionWarning: undefined,
      authStatus: builtinReady ? 'ok' : 'missing',
      authMessage: !builtinBinary
        ? '内置 runtime 缺失：重装应用即可恢复（或设 OPENCODE_BIN 指向一个 opencode 可执行文件）。'
        : byokView.baseUrl && byokView.model
          ? (byokView.apiKeyConfigured ? `已配置（•••• ${byokView.apiKeyTail}）` : '已配置（本地端点，无密钥）')
          : '未配置端点与模型，请在设置里填写',
      // 有原生附件通道（--file=<路径>）——题目图片能直接递送
      canAttachImages: true,
      models: builtinModels,
    });
    writeDetectionCache(detected);
    runtimes = detected;
  }

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
    runtimes,
    activeRuntime: RUNTIMES[0].id,
  });
}
