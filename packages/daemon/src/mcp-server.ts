/**
 * MCP 工具面 —— agent 调用的入口。
 *
 * 设计要点：
 *  - PNG 用 `image` content block 返回（而非嵌在 JSON 文本里），这样视觉模型
 *    能真正「看见」画布。这是「读写不对称」里感知侧的关键。
 *  - 结构化数据用 `text` block 承载 JSON，附一个纯文本摘要便于 agent 快速理解。
 *  - 工具签名不含 sessionId（签名寿命是第一资产）：会话 = 一个 daemon 进程。
 *    页面断开时如实报 GGB_SESSION_DEAD，不假装画布还在。
 *  - SOP 工具面（P1→P1.6）：get_expert_prompt 取流程+清单、get_sop_cards 按需取卡、
 *    submit_construction 收卷（校验剔除后下发 + 明细回传）。
 *    category 由会话账本自动记（get_expert_prompt 写入，submit_construction 取用）。
 *    分类由 agent 自己判——调 get_expert_prompt 时亮出 category，即完成分类+取材两件事。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  assembleDrawingPack,
  assembleSkill,
  buildCardIndex,
  buildCatalog,
  buildAllowedCommandsSuffix,
  checkLines,
  classifyLine,
  loadSopCards,
  loadWhitelist,
  semanticCheck,
  type BoardState,
  type DiffResult,
} from '@mathmover/ggb-core';
import type { GgbTools } from './tools.ts';

/** MCP CallToolResult.content 的实用别名（text + image 两种块）。 */
type ToolContent = Array<
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
>;

/** 题目分类学（get_expert_prompt 的判定标准；与 ggb-core 的类别→skill 映射同源）。 */
const CATEGORY_TAXONOMY =
  'A：函数与图像（一次函数、开口向上/向下的二次函数（抛物线）、三角函数、导数、一般函数）\n' +
  'B：平面几何（圆、多边形、角平分线、平面向量）\n' +
  'C：解析几何（椭圆、双曲线、开口向左/向右的抛物线、圆锥曲线）\n' +
  'D：立体几何（正方体、四面体、空间动点、球、旋转体）';

/** 模型友好：把 BoardState 压成一段可直接读的文本摘要。 */
function describeState(s: BoardState): string {
  const lines: string[] = [];
  lines.push(`画布状态（generation=${s.generation}, mode=${s.mode}）`);
  lines.push(`构建指令 ${s.commands.length} 行，对象 ${s.objects.length} 个，滑块 ${s.sliders.length} 个。`);

  if (s.objects.length > 0) {
    lines.push('');
    lines.push('【对象】');
    for (const o of s.objects) {
      const flag = o.independent ? '可拖动' : '由定义决定';
      lines.push(`- ${o.name}: ${o.type} = ${o.value ?? '(无值)'}  [${flag}]`);
    }
  }

  if (s.sliders.length > 0) {
    lines.push('');
    lines.push('【滑块/自由参数】');
    for (const sl of s.sliders) {
      const range = sl.rangeIsDefault
        ? `(范围未由 applet 暴露，仅示默认 ${sl.min}~${sl.max})`
        : `(${sl.min} ~ ${sl.max})`;
      lines.push(`- ${sl.name} = ${sl.value} ${range}`);
    }
  }

  if (s.audit.findings.length > 0) {
    lines.push('');
    lines.push('【体检发现问题】');
    for (const f of s.audit.findings) {
      lines.push(`- [${f.kind === 'missing' ? '对象缺失' : '值未定义'}] ${f.name}  ← ${f.line}`);
    }
    lines.push('提示：这些对象可能构建失败或取值无效，修改时应一并处理。');
  } else {
    lines.push('体检：全部对象建立正常，无未定义值。');
  }

  if (s.degraded) {
    lines.push(`注意：本次采集有降级项 —— ${s.degradedReasons.join('、')}`);
  }
  return lines.join('\n');
}

function describeDiff(d: DiffResult): string {
  if (d.entries.length === 0) return d.summary;
  const lines = [d.summary, ''];
  for (const e of d.entries) {
    const name = e.name ?? '(无名指令)';
    if (e.op === 'added') lines.push(`+ 新增 ${name}: ${e.after}`);
    else if (e.op === 'removed') lines.push(`- 删除 ${name}: ${e.before}`);
    else {
      lines.push(`~ 修改 ${name}:`);
      lines.push(`    改前: ${e.before}`);
      lines.push(`    改后: ${e.after}`);
    }
  }
  lines.push(`（另有 ${d.unchangedCount} 行未变动）`);
  return lines.join('\n');
}

function stateContent(s: BoardState) {
  const content: ToolContent = [
    { type: 'text', text: describeState(s) },
    { type: 'text', text: JSON.stringify({ objects: s.objects, sliders: s.sliders, audit: s.audit, mode: s.mode, generation: s.generation, degraded: s.degraded, degradedReasons: s.degradedReasons }, null, 2) },
  ];
  // PNG 作为 image block，让视觉模型真正看到画布
  if (s.png.base64) {
    content.push({ type: 'image', data: s.png.base64, mimeType: 'image/png' });
  }
  return { content, isError: false as const };
}

function errContent(e: unknown) {
  const content: ToolContent = [{ type: 'text', text: String(e instanceof Error ? e.message : e) }];
  return { content, isError: true as const };
}

export function createMcpServer(
  tools: GgbTools,
  info: { name: string; version: string },
  opts: { rootDir?: string } = {},
): McpServer {
  const server = new McpServer({ name: info.name, version: info.version });
  const rootDir = opts.rootDir ?? process.cwd();

  // 会话账本：category 归属（get_expert_prompt 写，submit_construction 读）。
  // 会话 = 一个 daemon 进程（签名不带 sessionId），进程级单份即"会话账本"。
  const ledger: { category?: string; reason?: string; at?: number } = {};

  server.registerTool('ggb_get_state', {
    title: '读取 GeoGebra 画布当前状态',
    description:
      '读取画布当前的构建指令、对象清单、滑块值、体检结果，并返回画布截图。' +
      '在需要理解「现在画布上有什么」时调用（例如用户说"那条红色虚线"时，必须先看状态才知道是哪条）。' +
      '返回的图片就是用户此刻看到的同一画面。',
    inputSchema: {
      png: z.boolean().optional().describe('是否附带画布截图，默认 true。仅在不需要视觉信息时可设 false 以省流量。'),
    },
  }, async (args) => {
    try {
      return stateContent(await tools.getState({ png: args?.png ?? true }));
    } catch (e) {
      return errContent(e);
    }
  });

  server.registerTool('ggb_apply', {
    title: '应用构造工作稿到画布',
    description:
      '把工作稿 `construction.ggb.txt` 下发到画布。**没有别的入口**——像改代码一样' +
      '编辑该文件（真 CLI 用原生编辑能力；BYOK 用 write_construction），改完调本工具生效。' +
      '返回新状态、体检结果，以及相对上一版的改动说明。' +
      '**边构边调**：每完成一段就 apply 一次，用户能看着图一点点长出来，而不是等很久一次出全图。',
    inputSchema: {
      png: z.boolean().optional().describe('返回结果是否附带画布截图，默认 true。'),
    },
  }, async (args) => {
    try {
      const r = await tools.apply(undefined, { png: args?.png ?? true });
      const content: ToolContent = [
        { type: 'text', text: describeDiff(r.diff) },
        { type: 'text', text: describeState(r.state) },
      ];
      // 超时降级：结果可能已生效但未被完整确认——必须让 agent 知道，
      // 否则它会误以为成功（或反过来误以为失败而重做一遍）。
      if ((r as { unconfirmed?: boolean }).unconfirmed) {
        content.unshift({
          type: 'text',
          text:
            '⚠ 本次执行超时，**结果未被完整确认**。构造很可能已经生效——' +
            '下面的状态是超时后重新读取画布得到的。请核对对象清单与截图，' +
            '确认无误后再向用户汇报；若不对，重新提交完整清单。',
        });
      }
      if ((r as { incremental?: boolean }).incremental) {
        content.unshift({
          type: 'text',
          text: '本次为增量应用（未清屏，新对象直接叠加在现有图上）。',
        });
      }
      if (r.failedFirstPass.length > 0) {
        content.push({
          type: 'text',
          text: `注意：以下 ${r.failedFirstPass.length} 行两遍执行都未成功，可能无效：\n` +
            r.failedFirstPass.map((x) => `  ${x}`).join('\n'),
        });
      }
      content.push({ type: 'text', text: JSON.stringify({
        diff: r.diff, applied: r.applied.length, failedFirstPass: r.failedFirstPass,
        durationMs: r.durationMs, incremental: (r as { incremental?: boolean }).incremental ?? false,
      }, null, 2) });
      if (r.state.png.base64) {
        content.push({ type: 'image', data: r.state.png.base64, mimeType: 'image/png' });
      }
      return { content, isError: false };
    } catch (e) {
      return errContent(e);
    }
  });

  server.registerTool('ggb_reset', {
    title: '清空画布',
    description: '清空当前 GeoGebra 构造。会同时清空账本。谨慎调用。',
    inputSchema: {},
  }, async () => {
    try {
      await tools.reset();
      ledger.category = undefined;
      ledger.reason = undefined;
      return { content: [{ type: 'text', text: '画布已清空。' }], isError: false };
    } catch (e) {
      return errContent(e);
    }
  });

  // ── 画图工具面 ────────────────────────────────────────────────
  // 产品定位是 agent 驱动的 GeoGebra 画图工作台。自由画图走 get_drawing_pack；
  // 只有「拿题图转 GeoGebra」这条链路才需要 A/B/C/D 专家流程（get_expert_prompt）。

  server.registerTool('get_drawing_pack', {
    title: '取画图基础包 + 全库写法卡清单',
    description:
      '**自由画图（用户没给题目图）从这里开始**。一次给两样：① 画图基础包——公共输出约定、' +
      '每题必用的 GGB 通用写法（MODE/视图/点/线/标签/样式）、严格语法约束（2D+3D 全列）；' +
      '② 全库写法卡清单（不按类别裁剪，含每张卡的一句话说明与适用输入）。' +
      '清单只是目录，具体写法要另外用 get_sop_cards 取；不确定怎么写就取，别凭印象编。\n' +
      '**只有「拿题图转 GeoGebra」才需要专家建模流程**——那种任务改调 get_expert_prompt 并给出题目类别。',
    inputSchema: {},
  }, async () => {
    try {
      // 自由画图：清掉可能残留的题目类别，免得 submit_construction 误套类别结构检查
      ledger.category = undefined;
      ledger.reason = undefined;
      const { text, characters } = assembleDrawingPack(rootDir);
      const suffix = buildAllowedCommandsSuffix(undefined, loadWhitelist(rootDir).names);
      const index = buildCardIndex(rootDir);
      return {
        content: [
          { type: 'text', text: text + suffix },
          {
            type: 'text',
            text:
              `写法卡清单（全库 ${index.length} 张）——需要哪张就 get_sop_cards 取：\n` +
              index.map((c) => `- ${c.name}：${c.title}${c.inputs ? `｜输入：${c.inputs}` : ''}`).join('\n'),
          },
          {
            type: 'text',
            text: JSON.stringify({ mode: 'drawing', characters: characters + suffix.length, cards: index.length, catalog: index }),
          },
        ],
        isError: false,
      };
    } catch (e) {
      return errContent(e);
    }
  });

  server.registerTool('get_expert_prompt', {
    title: '取专家建模流程 + 本类写法卡清单',
    description:
      '**题图→GeoGebra 专用**：用户发了题目图片/题面、要把题目变成动图时才调这个，' +
      '平时自由画图请用 get_drawing_pack。一次取两样——① 专家 skill（8 步建模流程、' +
      '每题必用的 GGB 通用写法、严格语法约束）；② 本类的写法卡清单（一句话说明 + 适用输入 + 挂在流程第几步）。' +
      '清单只是目录，具体写法要另外用 get_sop_cards 取；不确定怎么写就取，别凭印象编。' +
      'category 由你根据题目自己判（没有单独的分类步骤，调本工具即完成分类）；' +
      '中途发现判错了就换个 category 再调一次，覆盖账本即可。\n分类标准：\n' + CATEGORY_TAXONOMY,
    inputSchema: {
      category: z.enum(['A', 'B', 'C', 'D']).describe(
        '题目类别（必填，你来判）：A 函数与图像 / B 平面几何 / C 解析几何 / D 立体几何',
      ),
    },
  }, async (args) => {
    try {
      const category = args?.category;
      if (!category) return errContent(new Error('必须给出 category（A/B/C/D）——由你根据题目判定'));
      ledger.category = category;
      ledger.at = Date.now();
      const { text, metadata } = assembleSkill(category, rootDir);
      const suffix = buildAllowedCommandsSuffix(category, loadWhitelist(rootDir).names);
      const catalog = buildCatalog(category, rootDir);
      return {
        content: [
          { type: 'text', text: text + suffix },
          {
            type: 'text',
            text:
              `写法卡清单（${category} 类，共 ${catalog.length} 张）——需要哪张就 get_sop_cards 取：\n` +
              catalog.map((c) => `- ${c.name}${c.step ? `（流程第 ${c.step} 步）` : ''}：${c.title}${c.inputs ? `｜输入：${c.inputs}` : ''}`).join('\n'),
          },
          {
            type: 'text',
            text: JSON.stringify({
              category, skill: metadata.skill, cards: metadata.cards,
              characters: metadata.characters + suffix.length,
              catalog,
            }),
          },
        ],
        isError: false,
      };
    } catch (e) {
      return errContent(e);
    }
  });

  server.registerTool('get_sop_cards', {
    title: '批量取写法卡',
    description:
      '按名字取写法卡正文（GGB 指令的具体写法、示例、易错点）。从 get_expert_prompt 的清单里挑；' +
      '一次可以取多张。用完即可——写到哪步不确定写法就再取，不要凭记忆编指令。',
    inputSchema: {
      names: z.array(z.string()).min(1).describe('卡片名列表，如 ["intersection", "locus"]'),
    },
  }, async (args) => {
    try {
      const names = (args?.names ?? []).map((n) => String(n));
      const { cards, unknown, suggestions } = loadSopCards(names, rootDir);
      const content: ToolContent = [];
      for (const c of cards) content.push({ type: 'text', text: `【${c.name}】\n${c.text}` });
      if (unknown.length) {
        content.push({
          type: 'text',
          text: `未找到的卡片：${unknown.join('、')}${suggestions.length ? `；相近的有：${suggestions.join('、')}` : ''}`,
        });
      }
      if (cards.length === 0) {
        return errContent(new Error(`没有取到任何卡片${unknown.length ? `（未知名：${unknown.join('、')}）` : ''}，请按清单里的名字取`));
      }
      return { content, isError: false };
    } catch (e) {
      return errContent(e);
    }
  });

  server.registerTool('submit_construction', {
    title: '提交构造（收卷：校验剔除后下发）',
    description:
      '收卷动作：提交工作稿 `construction.ggb.txt` 的完整清单。自动做两层检查并把失败明细回传给你自行决定改不改' +
      '（不会替你重生成）：① 行级——语法/未知命令的行剔除后下发，明细列出；' +
      '② 语义级——动点自洽（free_param / orphan_slider）恒查；' +
      '若是题图→GeoGebra，再按类别查结构（A 要函数/方程、B 要多边形/圆、C 要圆锥曲线、D 要 3D）。' +
      '**自由画图不要给 category**，硬套题目类别会得出无关的告警。' +
      '**先用 ggb_apply 边构边看，最后收卷**。',
    inputSchema: {
      title: z.string().optional().describe(
        '给这个任务起个短名（8 字以内为宜）。**概括用户第一条消息要做什么**，' +
        '不是概括你画成了什么——标题命名的是「请求」，多轮微调后也不该变。' +
        '如用户说「画个抛物线，焦点在(1,0)，再画条过焦点的直线」→「抛物线与过焦点直线」。' +
        '不给则回退到用户首条消息的截断。',
      ),
      category: z.enum(['A', 'B', 'C', 'D']).optional().describe(
        '题目类别：**仅题图→GeoGebra 链路需要**（那时会多查类别结构）。' +
        '自由画图不给。不给则用账本里已登记的（get_expert_prompt 写入）；跨轮续接请直接传',
      ),
      png: z.boolean().optional().describe('返回结果是否附带画布截图，默认 true'),
    },
  }, async (args) => {
    try {
      const category = args?.category ?? ledger.category;
      if (args?.category) ledger.category = args.category;
      const source = tools.readConstruction();
      const rawLines = source.flatMap((c) => String(c).split('\n'));
      const { knownLower } = loadWhitelist(rootDir);

      // ① 行级：剔除语法无效行 + 未知命令行（宁可放过的是可解析行；这类行下发必败）
      const lineCheck = checkLines(rawLines.join('\n'), knownLower);
      const dropped = new Set<string>();
      for (const raw of rawLines) {
        const t = raw.trim();
        if (!t || t.startsWith('//')) continue;
        // 与 checkLines 同判据：整行不可解析 -> 剔
        if (classifyLine(raw).kind === 'unknown') dropped.add(raw);
      }
      for (const u of lineCheck.unknownCommands) dropped.add(u.line);
      const cleaned = rawLines.filter((l) => !dropped.has(l));

      // ② 语义级：明细回传（不拦下发——验证闭环不进生成链路）
      const semantic = semanticCheck(category, cleaned.join('\n'), {
        knownCommandLower: knownLower,
      });

      const r = await tools.apply(cleaned, { png: args?.png ?? true });
      const title = typeof args?.title === 'string' ? args.title.trim().slice(0, 60) : '';
      const content: ToolContent = [
        { type: 'text', text: (title ? `已命名为「${title}」。` : '') + (category
          ? `已按类别 ${category} 校验并下发 ${cleaned.length} 行（剔除 ${dropped.size} 行）。`
          : `已校验并下发 ${cleaned.length} 行（剔除 ${dropped.size} 行）。`) },
      ];
      if (dropped.size) {
        content.push({
          type: 'text',
          text: `剔除的行（无效/未知命令，未下发）：\n${[...dropped].map((x) => `  ${x}`).join('\n')}`,
        });
      }
      if (!semantic.ok) {
        content.push({
          type: 'text',
          text: '语义自查未全过（不影响已下发内容，请自行决定是否修正）：\n' +
            semantic.failures.map((f) => `  [${f.check}] ${f.detail}`).join('\n'),
        });
      }
      content.push({ type: 'text', text: describeDiff(r.diff) });
      content.push({ type: 'text', text: describeState(r.state) });
      content.push({
        type: 'text',
        text: JSON.stringify({
          category,
          applied: r.applied.length,
          droppedLines: [...dropped],
          lineCheck: { validity: lineCheck.validity, unknownCommands: lineCheck.unknownCommands },
          semantic,
        }, null, 2),
      });
      if (r.state.png.base64) {
        content.push({ type: 'image', data: r.state.png.base64, mimeType: 'image/png' });
      }
      return { content, isError: false };
    } catch (e) {
      return errContent(e);
    }
  });

  // BYOK 等无原生文件能力的 agent 走这两个工具读写工作稿；
  // 真 CLI（claude/codex/dsh）直接用自带的 Read/Edit，不必调它们。
  server.registerTool('read_construction', {
    title: '读构造工作稿',
    description:
      '读取当前构造工作稿 `construction.ggb.txt` 的内容（每行一条 GeoGebra 指令）。' +
      '真 CLI 有原生读文件能力，直接读文件即可；本工具给没有文件能力的 agent 用。',
    inputSchema: {},
  }, async () => {
    const lines = tools.readConstruction();
    return {
      content: [{
        type: 'text',
        text: lines.length
          ? lines.join('\n')
          : '（工作稿为空——画布上还没有构造）',
      }],
      isError: false,
    };
  });

  server.registerTool('write_construction', {
    title: '写构造工作稿',
    description:
      '用完整清单**覆盖**工作稿 `construction.ggb.txt`。真 CLI 有原生编辑能力，直接改文件即可；' +
      '本工具给没有文件能力的 agent（BYOK）用。' +
      'apply:true = 写完顺手下发画布（省一轮 ggb_apply）；默认只写草稿不下发。',
    inputSchema: {
      commands: z.array(z.string()).min(1).describe('完整 GeoGebra 指令清单，每行一条（含 MODE: 首行可选、// 注释可选）'),
      apply: z.boolean().optional().describe('写完是否顺手下发画布，默认 false。BYOK 建议 true——省一轮 ggb_apply。'),
    },
  }, async (args) => {
    const commands = (args?.commands ?? []).map((c) => String(c));
    const file = tools.writeConstruction(commands);
    if (args?.apply) {
      const r = await tools.apply(undefined, { png: true });
      return {
        content: [
          { type: 'text', text: `工作稿已写入 ${commands.length} 行并下发画布。` },
          { type: 'text', text: describeDiff(r.diff) },
          { type: 'text', text: describeState(r.state) },
        ],
        isError: false,
      };
    }
    return {
      content: [{ type: 'text', text: `工作稿已写入 ${commands.length} 行${file ? `（${file}）` : ''}。要生效请调 ggb_apply()。` }],
      isError: false,
    };
  });

  return server;
}

/** 以 stdio 方式启动 MCP 服务（agent 通过 stdio 与之通信）。 */
export async function serveStdio(
  tools: GgbTools,
  info: { name: string; version: string },
  opts: { rootDir?: string } = {},
): Promise<void> {
  const server = createMcpServer(tools, info, opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
