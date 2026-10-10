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
  assembleSkill,
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
    title: '全量替换 GeoGebra 构造',
    description:
      '用一份**完整的 GeoGebra 指令清单**替换当前画布。这是唯一写入方式——不做增量补丁。' +
      '请输出更新后的全量清单（未修改的对象保持原名原定义不变），而不是只给变化的行。' +
      '执行后返回新状态、体检结果，以及相对上一版的改动说明（可用于向用户汇报"改了什么"）。',
    inputSchema: {
      commands: z.array(z.string()).min(1).describe(
        'GeoGebra 指令清单，每行一条。形如 "A = (0, 0)"、"f = Line(A, B)"、"SetColor(f, \\"#FF0000\\")"。' +
        '可含 MODE:2D 或 MODE:3D 首行、// 注释行（注释不会下发）。',
      ),
      png: z.boolean().optional().describe('返回结果是否附带画布截图，默认 true。'),
    },
  }, async (args) => {
    try {
      const r = await tools.apply(args?.commands ?? [], { png: args?.png ?? true });
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
      if (r.failedFirstPass.length > 0) {
        content.push({
          type: 'text',
          text: `注意：以下 ${r.failedFirstPass.length} 行两遍执行都未成功，可能无效：\n` +
            r.failedFirstPass.map((x) => `  ${x}`).join('\n'),
        });
      }
      content.push({ type: 'text', text: JSON.stringify({
        diff: r.diff, applied: r.applied.length, failedFirstPass: r.failedFirstPass,
        durationMs: r.durationMs,
      }, null, 2) });
      if (r.state.png.base64) {
        content.push({ type: 'image', data: r.state.png.base64, mimeType: 'image/png' });
      }
      return { content, isError: false };
    } catch (e) {
      return errContent(e);
    }
  });

  server.registerTool('ggb_diff', {
    title: '比较两份 GeoGebra 指令清单',
    description:
      '计算两份指令清单的语义差异（按对象名对齐，不按行号），返回中文改动摘要。' +
      '不触动画布。适合在向用户说明"我改了什么"之前自查，或比较历史版本。',
    inputSchema: {
      before: z.array(z.string()).describe('改动前的指令清单'),
      after: z.array(z.string()).describe('改动后的指令清单'),
    },
  }, async (args) => {
    try {
      const d = tools.diff(args?.before ?? [], args?.after ?? []);
      return {
        content: [
          { type: 'text', text: describeDiff(d) },
          { type: 'text', text: JSON.stringify(d, null, 2) },
        ],
        isError: false,
      };
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

  // ── SOP 三工具（P1→P1.5）：流程与写法分家，写法按需取 ────────────

  server.registerTool('get_expert_prompt', {
    title: '取专家流程 + 写法卡清单',
    description:
      '本题属于哪一类，就调哪一类的：一次取两样——① 专家 skill（建模流程、每题必用的 GGB 通用写法、严格语法约束）；' +
      '② 本类的写法卡清单（每张卡的一句话说明 + 适用输入 + 挂在流程第几步）。' +
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
      'SOP 流程的收卷动作：提交**完整** GeoGebra 指令清单。自动做两层检查并把失败明细回传给你自行决定改不改' +
      '（不会替你重生成）：① 行级——语法/未知命令的行剔除后下发，明细列出；' +
      '② 语义级——按账本类别查结构（A 要函数/方程、B 要多边形/圆、C 要圆锥曲线、D 要 3D）' +
      '与动点自洽（free_param / orphan_slider）。类别从账本取（get_expert_prompt 调用时已登记）。',
    inputSchema: {
      commands: z.array(z.string()).min(1).describe('完整 GeoGebra 指令清单，每行一条（含 MODE: 首行可选、// 注释可选）'),
      category: z.enum(['A', 'B', 'C', 'D']).optional().describe(
        '题目类别兜底：同轮内用账本的即可；跨轮续接时（工具进程已换）请把上一轮登记的类别传进来',
      ),
      png: z.boolean().optional().describe('返回结果是否附带画布截图，默认 true'),
    },
  }, async (args) => {
    try {
      const category = args?.category ?? ledger.category;
      if (!category) {
        return errContent(new Error(
          '账本无类别：先调 get_expert_prompt 取流程（调它即登记类别）；若是跨轮续接，把上一轮的类别直接传给本工具的 category 参数',
        ));
      }
      if (args?.category) ledger.category = args.category;
      const rawLines = (args?.commands ?? []).flatMap((c) => String(c).split('\n'));
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
      const content: ToolContent = [
        { type: 'text', text: `已按类别 ${category} 校验并下发 ${cleaned.length} 行（剔除 ${dropped.size} 行）。` },
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
