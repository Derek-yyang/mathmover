/**
 * MCP 工具面 —— agent 调用的入口。
 *
 * 设计要点：
 *  - PNG 用 `image` content block 返回（而非嵌在 JSON 文本里），这样视觉模型
 *    能真正「看见」画布。这是「读写不对称」里感知侧的关键。
 *  - 结构化数据用 `text` block 承载 JSON，附一个纯文本摘要便于 agent 快速理解。
 *  - 工具签名不含 sessionId（签名寿命是第一资产）：会话 = 一个 daemon 进程。
 *    页面断开时如实报 GGB_SESSION_DEAD，不假装画布还在。
 *  - **不做 submit_construction 一类的"收卷"工具**——那要先定 category 归属与
 *    语义校验语义（已裁定：category 由会话账本自动记、校验失败剔除后下发）。
 *    属下一步，等 TS 移植完 expert_prompts / semantic_guard 再开。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { BoardState, DiffResult } from '@mathmover/ggb-core';
import type { GgbTools } from './tools.ts';

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
  const content: Array<Record<string, unknown>> = [
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
  return {
    content: [{ type: 'text', text: String(e instanceof Error ? e.message : e) }],
    isError: true as const,
  };
}

export function createMcpServer(tools: GgbTools, info: { name: string; version: string }): McpServer {
  const server = new McpServer({ name: info.name, version: info.version });

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
      const content: Array<Record<string, unknown>> = [
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
      return { content: [{ type: 'text', text: '画布已清空。' }], isError: false };
    } catch (e) {
      return errContent(e);
    }
  });

  return server;
}

/** 以 stdio 方式启动 MCP 服务（agent 通过 stdio 与之通信）。 */
export async function serveStdio(tools: GgbTools, info: { name: string; version: string }): Promise<void> {
  const server = createMcpServer(tools, info);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
