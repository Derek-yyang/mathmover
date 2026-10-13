/**
 * MCP 工具面回归 —— agent 的全部界面。
 *
 * ggb-core 的函数各有单测，但 `registerTool` 这一层此前是零测试：工具改名、必填参数
 * 变可选、描述里的引导语被精简，都不会有任何测试变红，而 agent 的行为会悄悄变。
 * 这里把接口钉住：名单、必填参数、关键引导语，以及两个入口工具的真实产出。
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp-server.ts';
import { GgbTools, type ToolsConfig } from '../src/tools.ts';
import type { GgbBridgeClient } from '../src/bridge-client.ts';
import type { RawApplyResult, RawState } from '@mathmover/ggb-core';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const workdirs: string[] = [];

afterEach(() => {
  for (const dir of workdirs.splice(0)) {
    if (!dir.startsWith(path.join(os.tmpdir(), 'mm-mcp-tools-test-'))) throw new Error('Unsafe cleanup');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** 桥桩：让 apply/getState 能跑通，产出形状正确的 RawState。 */
function rawState(commands: string[] = []): RawState {
  return {
    commands,
    names: [],
    objects: {},
    sliders: [],
    png: null,
    pngSource: 'none',
    generation: 1,
  };
}

async function openClient() {
  const bridge: Pick<GgbBridgeClient, 'connected' | 'snapshot' | 'call'> = {
    connected: true,
    snapshot: null,
    call: <T>(op: string) => {
      if (op === 'apply') {
        return Promise.resolve({
          applied: [], failedFirstPass: [], durationMs: 1, state: rawState(['A = (0, 0)']),
        } as RawApplyResult as T);
      }
      return Promise.resolve(rawState(['A = (0, 0)']) as T);
    },
  };
  // workdir 必须指向临时目录：submit_construction 会往这里写构造文件，
  // 用默认的 process.cwd() 会把 construction.ggb.txt 拉进仓库。
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-mcp-tools-test-'));
  workdirs.push(workdir);
  const cfg: ToolsConfig = { workdir, includePng: false, pngMaxEdge: 900 };
  const server = createMcpServer(
    new GgbTools(bridge, cfg),
    { name: 'mcp-tools-test', version: '0.0.0' },
    { rootDir: REPO_ROOT },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mcp-tools-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** 一个工具的接线摘要。 */
function describeTool(tools: Array<{ name: string; description?: string; inputSchema: { required?: string[]; properties?: Record<string, unknown> } }>, name: string) {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`工具不存在：${name}`);
  return { required: t.inputSchema.required ?? [], params: Object.keys(t.inputSchema.properties ?? {}), description: t.description ?? '' };
}

/** 抽出 text 块的正文。入参收 unknown——CallToolResult 带索引签名，窄类型会对不上。 */
function textBlocks(r: unknown): string[] {
  const content = (r as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.filter((c) => c.type === 'text').map((c) => c.text ?? '');
}

describe('MCP 工具面', () => {
  it('工具名单与数量钉死（防误删/误加）', async () => {
    const client = await openClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_drawing_pack', 'get_expert_prompt', 'get_sop_cards',
      'ggb_apply', 'ggb_get_state', 'ggb_reset',
      'read_construction', 'submit_construction', 'write_construction',
    ]);
  });

  it('必填参数钉死：做题入口要类别、自由画图入口不要', async () => {
    const client = await openClient();
    const { tools } = await client.listTools();

    // 做题入口：category 必填——改回可选会让 agent 不分类就拿 skill
    expect(describeTool(tools, 'get_expert_prompt').required).toEqual(['category']);
    // 收卷：**没有 commands 参数**（唯一入口是工作稿文件），category 必须可选
    expect(describeTool(tools, 'submit_construction').params).not.toContain('commands');
    expect(describeTool(tools, 'submit_construction').required).not.toContain('category');
    expect(describeTool(tools, 'submit_construction').params).toContain('category');
    // 命名：可选（agent 起的课件名）。必填会让 agent 为了过 schema 乱编名字。
    expect(describeTool(tools, 'submit_construction').params).toContain('title');
    expect(describeTool(tools, 'submit_construction').required).not.toContain('title');
    // 自由画图入口：零参数
    expect(describeTool(tools, 'get_drawing_pack').params).toEqual([]);
    // 取卡按名字批量拿
    expect(describeTool(tools, 'get_sop_cards').required).toEqual(['names']);
    // 工作稿是唯一入口：ggb_apply 无 commands；读零参，写必带 commands（可选 apply 联动下发）
    expect(describeTool(tools, 'ggb_apply').params).not.toContain('commands');
    expect(describeTool(tools, 'read_construction').params).toEqual([]);
    expect(describeTool(tools, 'write_construction').required).toEqual(['commands']);
    expect(describeTool(tools, 'write_construction').params).toContain('apply');
    expect(describeTool(tools, 'write_construction').required).not.toContain('apply');
  });

  it('关键引导语在（删了会让 agent 行为漂移）', async () => {
    const client = await openClient();
    const { tools } = await client.listTools();
    const drawing = describeTool(tools, 'get_drawing_pack').description;
    const expert = describeTool(tools, 'get_expert_prompt').description;
    const submit = describeTool(tools, 'submit_construction').description;
    const cards = describeTool(tools, 'get_sop_cards').description;

    expect(drawing).toContain('自由画图');          // 指路：非做题走这里
    expect(expert).toContain('题图');               // 指路：做题专用
    expect(expert).toContain('分类标准');           // 分类学随工具下发
    expect(submit).toContain('自由画图不要给');      // 防止硬套题目类别
    expect(cards).toContain('不要凭记忆编指令');    // 防幻觉的核心纪律
  });

  it('get_drawing_pack 实跑：通用写法 + 全库清单，不含专家流程', async () => {
    const client = await openClient();
    const r = await client.callTool({ name: 'get_drawing_pack', arguments: {} });
    const texts = textBlocks(r);

    expect(texts.some((t) => t.includes('共同输出约定'))).toBe(true);
    expect(texts.some((t) => t.includes('通用 GGB 写法'))).toBe(true);
    // 自由画图可能是三维，命令约束不能按做题分类裁剪成只有 2D
    expect(texts.some((t) => t.includes('3D 构造命令'))).toBe(true);
    // 专家 8 步建模方法论只属于做题链路
    expect(texts.some((t) => t.includes('## 1. 清点对象'))).toBe(false);

    const meta = JSON.parse(texts[texts.length - 1]);
    expect(meta.mode).toBe('drawing');
    expect(meta.cards).toBe(18);
    expect(meta.catalog).toHaveLength(18);
    // 全库清单不按类别裁剪：做题时 A 类拿不到的三维卡也该看得到
    const names = meta.catalog.map((c: { name: string }) => c.name);
    expect(names).toContain('3d-frame');
    expect(names).toContain('function-object');
    for (const c of meta.catalog) expect(typeof c.title).toBe('string');
  });

  it('get_expert_prompt 实跑：专家流程 + 本类清单（带步骤号）', async () => {
    const client = await openClient();
    const r = await client.callTool({ name: 'get_expert_prompt', arguments: { category: 'A' } });
    const texts = textBlocks(r);

    expect(texts.some((t) => t.includes('## 1. 清点对象'))).toBe(true);
    expect(texts.some((t) => t.includes('共同输出约定'))).toBe(true);

    const meta = JSON.parse(texts[texts.length - 1]);
    expect(meta.category).toBe('A');
    expect(meta.skill).toBe('function-expert');
    expect(meta.catalog.length).toBe(meta.cards.length); // 清单与本类引用卡一一对应
    expect(meta.catalog.length).toBeLessThan(18);        // 只列本类，不是全库
    expect(meta.catalog.every((c: { step: string }) => typeof c.step === 'string')).toBe(true);
  });

  it('两个入口互不污染：画图包会清掉账本里的题目类别', async () => {
    const client = await openClient();
    // 先做题，账本记下 A 类
    await client.callTool({ name: 'get_expert_prompt', arguments: { category: 'A' } });
    // 再自由画图
    await client.callTool({ name: 'get_drawing_pack', arguments: {} });
    // 写工作稿后收卷（工作稿是唯一入口，不再接受 commands 参数）
    await client.callTool({
      name: 'write_construction',
      arguments: { commands: ['A = (0, 0)', 'B = (1, 1)'] },
    });
    const r = await client.callTool({ name: 'submit_construction', arguments: { png: false } });
    expect(textBlocks(r).some((t) => t.includes('已按类别 A'))).toBe(false);
    expect(textBlocks(r).some((t) => t.includes('已校验并下发'))).toBe(true);
  });
});
