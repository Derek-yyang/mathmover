import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { buildSystemBrief } from '../../math-mover-next/lib/server/system-brief.ts';
import { CanvasSession } from './sessions.ts';
import {
  MCP_APP_HTML,
  MCP_APP_MIME_TYPE,
  MCP_APP_RESOURCE_META,
  MCP_APP_TITLE,
  MCP_APP_URI,
} from './mcp-app.ts';
import {
  LocalCanvasService,
  defaultDataDirectory,
  type CanvasService,
} from './service.ts';

const sessionInstructions = `你正在使用 MathMover MCP 版。用户在宿主 Agent 中对话，画板显示在宿主内置画板面板或回退浏览器中。
每段新对话先调用 mathmover_open_canvas 创建独立画板；已有会话用 session_id 恢复，不能拿其他对话的 ID 操作。
工具会返回画板 URL、工作稿绝对路径与本会话 ID。支持 MCP Apps 的宿主会自动打开 MathMover 面板，优先使用该面板。只有宿主没有显示画板时，才使用内置浏览器打开 URL。
如果返回的 connected 为 true，说明原画板仍在宿主面板或标签页中运行；继续使用原面板即可，不要再打开第二个同会话标签页。
connected 仅代表工具调用当时的连接状态，首次创建时为 false 是正常的，不代表面板打开失败。若 ggb_apply 或 ggb_get_state 已成功，画板就已连接；完成后不要再用 present_files 或浏览器工具重复打开画板，直接给出简明结果和可点击链接即可。
MathMover 画板由独立本地服务托管，会跨任务继续运行。任务结束后用户仍可在画板拖动对象、保存和导出；下一次对话恢复同一 session_id 后可继续修改。
用你的原生 Read/Edit/Write 能力编辑返回的 construction.ggb.txt，完整保留“工作稿 → ggb_apply → 检查状态、语义与截图 → 集中修正”的流程。
ggb_get_state、ggb_apply、ggb_reset 必须携带当前画板的 session_id。知识工具的规则和 SOP 与 MathMover 共用。
不要使用操作系统命令打开外部浏览器。宿主无法自动打开时，给用户返回可点击的画板 URL。
工作稿是唯一可编辑构造来源。不要通过浏览器执行脚本绕过执行器来创建几何对象。
用户移动动点后，先读取当前画板状态再继续修改。完成后给出简明结果与画板链接。
只处理当前画板构造；除非用户明确要求，不要为一次绘图额外创建或更新工作区日志、记忆或说明文件。
用户可通过画板左上角“课件”切换、新建、重命名或删除本地课件。如果宿主提供了来自 MathMover 面板的当前课件上下文，以最新上下文中的 session_id 和 workfile 为准，先读取状态再编辑，不要沿用先前课件的路径。`;

const sopCardNamesSchema = {
  type: 'array',
  minItems: 1,
  items: { type: 'string' },
};

function sopCardNamesParameterSchema() {
  return {
    description: '卡片名列表，例如 ["intersection", "locus"]；同时接受单个卡名或包装后的列表。',
    anyOf: [
      sopCardNamesSchema,
      { type: 'string', minLength: 1 },
      {
        type: 'object',
        properties: {
          item: {
            anyOf: [sopCardNamesSchema, { type: 'string', minLength: 1 }],
          },
        },
        required: ['item'],
        additionalProperties: false,
      },
    ],
  };
}

function normalizeSopCardNames(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        // Pass through malformed JSON so the knowledge tool can report the error.
      }
    }
    return [trimmed];
  }
  if (value && typeof value === 'object' && 'item' in value) {
    return normalizeSopCardNames((value as { item?: unknown }).item);
  }
  return value;
}

export async function createRuntime(options: {
  dataDir?: string;
  distDir?: string;
  service?: CanvasService;
} = {}) {
  const dist = options.distDir ?? __dirname;
  const assets = path.join(dist, 'assets');
  const dataDir = path.resolve(options.dataDir ?? process.env.MATHMOVER_MCP_DATA_DIR ?? defaultDataDirectory());
  const service = options.service ?? await LocalCanvasService.create({ dataDir, distDir: dist });
  const knowledge = new CanvasSession(
    { id: randomUUID(), title: '知识', createdAt: new Date().toISOString() },
    path.join(dataDir, 'knowledge'),
    assets,
  );
  await knowledge.start();
  const definitions = (await knowledge.client.listTools()).tools;
  const drawingTools = new Set(['ggb_get_state', 'ggb_apply', 'ggb_reset']);
  const drawingBrief = buildSystemBrief(assets).replace('用户通过右侧对话框跟你说话。', '用户通过宿主 Agent 的对话界面跟你交流。');
  const instructions = `${sessionInstructions}\n\n${drawingBrief}`;
  const server = new Server(
    { name: 'mathmover', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} }, instructions },
  );
  const toolDefinitions = definitions.map(tool => {
    if (tool.name === 'get_sop_cards') {
      return {
        ...tool,
        inputSchema: {
          ...tool.inputSchema,
          properties: {
            ...tool.inputSchema.properties,
            names: sopCardNamesParameterSchema(),
          },
        },
      };
    }
    if (!drawingTools.has(tool.name)) return tool;
    return {
      ...tool,
      description: `${tool.description}\n工作稿路径由 mathmover_open_canvas 返回。必须携带当前会话的 session_id。`,
      inputSchema: {
        ...tool.inputSchema,
        properties: { ...tool.inputSchema.properties, session_id: { type: 'string', description: 'mathmover_open_canvas 返回的当前画板会话 ID' } },
        required: [...tool.inputSchema.required ?? [], 'session_id'],
      },
    };
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    {
      name: 'mathmover_open_canvas', title: '打开 MathMover 画板',
      description: '新对话创建独立画板；传 session_id 恢复已有会话。支持 MCP Apps 的宿主会直接打开 MathMover 面板。返回本地工作稿路径、画板 URL、连接状态和构造规范。只有宿主没有显示画板时才打开 URL；随后用原生文件工具编辑工作稿。',
      inputSchema: { type: 'object', properties: { session_id: { type: 'string', description: '恢复已有会话时传入，首次创建不填' }, title: { type: 'string', maxLength: 100, description: '新课件的简短名称' } }, additionalProperties: false },
      _meta: {
        ui: { resourceUri: MCP_APP_URI, visibility: ['model', 'app'] },
        workbuddy: { ui: { launchSurface: 'panel' } },
      },
    },
    {
      name: 'mathmover_list_canvases', title: '查找已保存的 MathMover 画板',
      description: '返回此 MCP 产品的数据目录中的画板 ID 和名称，供用户明确要求恢复课件时选择。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    ...toolDefinitions,
  ] }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{
      uri: MCP_APP_URI,
      name: 'mathmover-canvas',
      title: MCP_APP_TITLE,
      description: 'MathMover 动态画板宿主面板',
      mimeType: MCP_APP_MIME_TYPE,
      _meta: MCP_APP_RESOURCE_META,
    }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== MCP_APP_URI) throw new Error(`未知资源：${request.params.uri}`);
    return {
      contents: [{
        uri: MCP_APP_URI,
        mimeType: MCP_APP_MIME_TYPE,
        text: MCP_APP_HTML,
        _meta: MCP_APP_RESOURCE_META,
      }],
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const { name } = request.params;
      const args = request.params.arguments ?? {};
      if (name === 'mathmover_open_canvas') {
        if (args.session_id !== undefined && typeof args.session_id !== 'string') throw new Error('session_id 必须为字符串');
        if (args.title !== undefined && typeof args.title !== 'string') throw new Error('title 必须为字符串');
        const info = await service.open(args.session_id as string | undefined, args.title as string | undefined);
        return {
          content: [
            { type: 'text', text: JSON.stringify(info, null, 2) },
            { type: 'text', text: instructions },
          ],
          structuredContent: info,
          _meta: {
            'workbuddy.ai/artifact': {
              stableId: info.session_id,
              title: info.title,
            },
          },
        };
      }
      if (name === 'mathmover_list_canvases') {
        return { content: [{ type: 'text', text: JSON.stringify(await service.list(), null, 2) }] };
      }
      if (!definitions.some(tool => tool.name === name)) throw new Error(`未知工具：${name}`);
      if (!drawingTools.has(name)) {
        const normalized = name === 'get_sop_cards' && 'names' in args
          ? { ...args, names: normalizeSopCardNames(args.names) }
          : args;
        return await knowledge.client.callTool({ name, arguments: normalized });
      }
      if (typeof args.session_id !== 'string') throw new Error('请携带当前画板的 session_id，先调用 mathmover_open_canvas 获取。');
      return await service.call(name, args);
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  let closed = false;
  return { server, service, origin: service.origin, async close() {
    if (closed) return;
    closed = true;
    await knowledge.close();
    await server.close();
    await service.close();
  } };
}
