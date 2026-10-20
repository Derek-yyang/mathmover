/**
 * MCP 工具面 —— agent 调用的入口。
 *
 * 设计要点：
 *  - PNG 用 `image` content block 返回（而非嵌在 JSON 文本里），这样视觉模型
 *    能真正「看见」画布。这是「读写不对称」里感知侧的关键。
 *  - 结构化数据用 `text` block 承载 JSON，附一个纯文本摘要便于 agent 快速理解。
 *  - 工具签名不含 sessionId（签名寿命是第一资产）：会话 = 一个 daemon 进程。
 *    页面断开时如实报 GGB_SESSION_DEAD，不假装画布还在。
 *  - SOP 工具面（P1→P1.6）：get_expert_prompt 取流程+清单、get_sop_cards 按需取卡。
 *    分类由 agent 自己判——调 get_expert_prompt 时亮出 category，即完成分类+取材两件事。
 *    **类别只用于选知识包**，写路径与它无关（按类别的形状检查已从 ggb-core/semantic.ts 移除）。
 *  - 校验（行级 + 动点自洽）挂在 ggb_apply 上，**只报不删**；收卷工具 submit_construction
 *    已于 2026-10-15 删除，课件命名改走正文标记（agent-runtime 的 title-marker.ts）。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  assembleSkill,
  buildCatalog,
  buildAllowedCommandsSuffix,
  inspectLedger,
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

  // 一条链路：把用户意图变成 GeoGebra 构造。题目图片只是输入形态，碰到时多拿
  // 一套建模知识（get_expert_prompt），不是「换模式」。无会话级 category 账本——
  // category 只决定取哪套知识包，写路径不依赖它。

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
      '把工作稿 `construction.ggb.txt`（在受管工作目录下，绝对路径见系统简报）下发到画布。' +
      '**没有别的入口**——像改代码一样' +
      '编辑该文件（用你的原生编辑能力），改完调本工具生效。' +
      '返回新状态、体检结果、相对上一版的改动说明，以及**行级与语义自查**：' +
      '不可解析/未知命令的行、动点自洽（引用了未定义的名字、或滑块没驱动任何对象）。' +
      '**边构边调**：每完成一段就 apply 一次，用户能看着图一点点长出来，而不是等很久一次出全图。',
    inputSchema: {
      png: z.boolean().optional().describe('返回结果是否附带画布截图，默认 true。'),
    },
  }, async (args) => {
    try {
      // 校验的是**工作稿本身**（agent 写的那份），不是画布回显的账本——回显经过增量合并，
      // 而且宿主委托那条路会把它换掉（dashboard 的 applyCommands 直接 `ledger ?? commands`）。
      // 报的是「你文件里有问题行」，就得读文件。
      //
      // 判据走 `inspectLedger`（= ggb_catalog.py 的移植）：**只有两件事**——名字在不在
      // 白名单、用法对不对（**只有带签名的命令才查用法**）。绝不再用 `classifyLine` 的
      // 结构分类当有效性判据：那会把 `ShowGrid(1, true)` / `ZoomIn(2)` 这类合法命令
      // 误报成无效（实测让 agent 白改了三轮）。
      const source = await tools.readConstruction();
      const draftLines = source.flatMap((c) => String(c).split('\n'));
      const { knownLower } = loadWhitelist(rootDir);
      const ledgerCheck = inspectLedger(draftLines, undefined, rootDir);
      const semantic = semanticCheck(draftLines.join('\n'), { knownCommandLower: knownLower });

      // **不剔除**：剔了 daemon 会把净化后的账本回写工作稿，agent 刚写的那行就从它自己的
      // 文件里消失；而 apply 是「每完成一段就调一次」的高频动作。未知命令在 GeoGebra 里
      // 只是执行失败、不生成对象，画布不会脏。
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
      // 问题行放**第一条**（上面的 unshift 之后，它才真正落在首位）：别把无效行埋在
      // 一堆 text 块中间——agent 会略过。明确说「还在文件里、我们没替你删」，它才不会
      // 以为文件已经被收拾干净。
      // 逐条给**具体理由**（未知命令 / 参数个数 / 类型 / 视图 / 副作用命令当表达式用），
      // 而不是笼统一句「无效行」——agent 拿到理由才知道怎么改。
      const problems: string[] = [];
      if (ledgerCheck.problems.length) {
        problems.push(`以下 ${ledgerCheck.problems.length} 行有问题（画布上没有它们产生的对象）：\n` +
          ledgerCheck.problems.map((p) =>
            `  第 ${p.index + 1} 行 ${p.line}\n` +
            p.problems.map((x) => `    · ${x.detail}`).join('\n')).join('\n'));
      }
      if (!semantic.ok) {
        problems.push('动点自洽未过：\n' + semantic.failures.map((f) => `  [${f.check}] ${f.detail}`).join('\n'));
      }
      if (problems.length) {
        content.unshift({
          type: 'text',
          text: '⚠ 工作稿里有问题行——**它们还在文件里，我们没有替你删**：\n\n' +
            problems.join('\n\n') +
            '\n\n请改掉它们（或删掉）后再收工；带着无效行收工，用户看到的就是一张缺东西的图。',
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
        invalidLines: ledgerCheck.unknownLines,
        problems: ledgerCheck.problems,
        semantic,
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
    title: '清空画布与工作稿',
    // 「工作稿也会被清空」必须写在描述里：2026-10-20 实跑中 agent 拿 reset 当「画板卡住了」的
    // 自救手段，结果 57 行工作稿一起没了，下一次 apply 直接报「工作稿是空的」，只好整份重写
    // （多花一次 49 秒的全量下发）。描述与返回文案都说清楚，它才知道接下来该重写。
    description: '清空当前 GeoGebra 构造，**同时清空工作稿 construction.ggb.txt**'
      + '（那份文件会变成空文件——它就是画布的真相来源，留着就等于留着一份用户已经删掉的图）。'
      + '清空后要重画，请把完整指令重新写进工作稿再 ggb_apply。谨慎调用。',
    inputSchema: {},
  }, async () => {
    try {
      // 先数一下要清掉几行，好让 agent 知道自己丢了什么、要不要重写
      const before = await tools.readConstruction();
      await tools.reset();
      const lines = before.filter((line) => line.trim()).length;
      return {
        content: [{
          type: 'text',
          text: `画布与工作稿都已清空（工作稿原有 ${lines} 行）。`
            + (lines > 0 ? '要恢复刚才那张图，需把完整指令重新写进工作稿再 ggb_apply。' : ''),
        }],
        isError: false,
      };
    } catch (e) {
      return errContent(e);
    }
  });


  // ── 知识供给 ────────────────────────────────────────────────
  // 一条链路：画图。通用写法与卡片目录已在系统简报里（人人都拿到）；
  // **带了题目图片**时另取 get_expert_prompt 拿一套建模知识（增强，不是换模式）。

  server.registerTool('get_expert_prompt', {
    title: '取题目建模方法 + 本类写法卡清单（增强）',
    description:
      '**题目增强——只在带了题目图片时取**：把题图变成动图才需要它。' +
      '只有文字（哪怕读起来像题面），或「画一个正方体」「画条抛物线」这类直接指令，**都不要取**——' +
      '取了它会按题图那套画（顶点与真实棱逐条展开、样式齐全），直接画不需要这个代价。' +
      '一次取两样——① 专家 skill（8 步建模流程、每题必用的 GGB 通用写法、严格语法约束）；' +
      '② 本类的写法卡清单（一句话说明 + 适用输入 + 挂在流程第几步）。' +
      '清单只是目录，具体写法要另外用 get_sop_cards 取；不确定怎么写就取，别凭印象编。' +
      'category 由你根据题目自己判，只决定取哪套建模知识。\n分类标准：\n' + CATEGORY_TAXONOMY,
    inputSchema: {
      category: z.enum(['A', 'B', 'C', 'D']).describe(
        '题目类别（必填，你来判）：A 函数与图像 / B 平面几何 / C 解析几何 / D 立体几何',
      ),
    },
  }, async (args) => {
    try {
      const category = args?.category;
      if (!category) return errContent(new Error('必须给出 category（A/B/C/D）——由你根据题目判定'));
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

  // 2026-10-15 删除 submit_construction（收卷）：
  //  - 行级剔除 + 动点自洽并进了 ggb_apply（**只报不删**，见那里的注释）；
  //  - 课件命名改走正文标记 `<mm-title>`（agent-runtime 的 title-marker.ts），
  //    宿主剥出来发 title 事件——不吃工具调用频次，某轮一次工具都没调也拿得到。
  // 于是「交卷」这个动作没有剩余职责了。
  //
  // 2026-10-18 删除 read_construction / write_construction 与整个 byok 工具集：
  // 它们只为「没有原生文件能力的 agent」存在，而那个自研 BYOK 循环已经被
  // 自带分发的 OpenCode runtime 取代（内置位与三条 CLI 同构，自带 Read/Edit）。
  // 工作稿的读写仍在 daemon 内部走 GgbTools（HTTP 面与 ggb_apply 都用它），
  // 只是不再作为一种 MCP 工具暴露给 agent。

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
