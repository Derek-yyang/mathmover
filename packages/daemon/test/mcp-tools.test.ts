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

async function openClient(opts: { wrapAsync?: boolean; toolset?: 'cli' | 'byok' } = {}) {
  const { wrapAsync = false, toolset = 'cli' } = opts;
  const bridge: Pick<GgbBridgeClient, 'connected' | 'snapshot' | 'call'> = {
    connected: true,
    snapshot: null,
    // 回显**下发的清单**（真画布的账本就是它）——桩若恒定回一份写死的清单，
    // apply 的写回就会把工作稿冲成那一份，「文件没被动过」这类断言就测不准了。
    call: <T>(op: string, args?: unknown) => {
      const sent = (args as { commands?: string[] } | undefined)?.commands ?? ['A = (0, 0)'];
      if (op === 'apply') {
        return Promise.resolve({
          applied: [], failedFirstPass: [], durationMs: 1, state: rawState(sent),
        } as RawApplyResult as T);
      }
      return Promise.resolve(rawState(sent) as T);
    },
  };
  // workdir 必须指向临时目录：apply 会往这里写构造文件，
  // 用默认的 process.cwd() 会把 construction.ggb.txt 拉进仓库。
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-mcp-tools-test-'));
  workdirs.push(workdir);
  const cfg: ToolsConfig = { workdir, includePng: false, pngMaxEdge: 900 };
  const local = new GgbTools(bridge, cfg);
  // wrapAsync 模拟 tools-http 的形态：readConstruction/writeConstruction 返回 Promise。
  // 真 agent 走的就是这条路（mcp-stdio → HTTP），漏 await 在同步 GgbTools 上测不出来。
  // 注意不能 `{...local}`——class 方法在原型上，spread 会丢。
  const tools = wrapAsync
    ? {
        getState: (o?: { png?: boolean }) => local.getState(o),
        apply: (c?: string[], o?: { png?: boolean; incremental?: boolean }) => local.apply(c, o),
        reset: () => local.reset(),
        ping: () => local.ping(),
        readConstruction: async () => local.readConstruction(),
        writeConstruction: async (cmds: string[]) => local.writeConstruction(cmds),
      }
    : local;
  const server = createMcpServer(
    tools as never,
    { name: 'mcp-tools-test', version: '0.0.0' },
    { rootDir: REPO_ROOT, toolset },
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
    // 真 CLI 自带 Read/Edit——文件兜底工具不该出现在它面前（会诱导混用、徒增往返）
    const cli = await openClient();
    expect((await cli.listTools()).tools.map((t) => t.name).sort()).toEqual([
      'get_expert_prompt', 'get_sop_cards',
      'ggb_apply', 'ggb_get_state', 'ggb_reset',
    ]);
    // BYOK 无原生文件能力，需要 read/write_construction 兜底
    const byok = await openClient({ toolset: 'byok' });
    expect((await byok.listTools()).tools.map((t) => t.name).sort()).toEqual([
      'get_expert_prompt', 'get_sop_cards',
      'ggb_apply', 'ggb_get_state', 'ggb_reset',
      'read_construction', 'write_construction',
    ]);
  });

  it('必填参数钉死：题目增强要类别', async () => {
    // 含 read/write_construction 的参数钉，需 byok 面
    const client = await openClient({ toolset: 'byok' });
    const { tools } = await client.listTools();

    // 题目增强：category 必填——改回可选会让 agent 不判类就拿 skill
    expect(describeTool(tools, 'get_expert_prompt').required).toEqual(['category']);
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
    const expert = describeTool(tools, 'get_expert_prompt').description;
    const apply = describeTool(tools, 'ggb_apply').description;
    const cards = describeTool(tools, 'get_sop_cards').description;

    expect(expert).toContain('题目增强');                    // 增强能力，不是「专用链路」
    expect(expert).toContain('只在带了题目图片时取');        // 触发键是题图，不是「文字题面」
    expect(expert).toContain('都不要取');                    // 反例在位：直接指令不算题面
    expect(expert).toContain('分类标准');                    // 分类学随工具下发
    expect(apply).toContain('动点自洽');              // 校验并进 apply 后的语义检查
    expect(apply).toContain('自查');                  // 回执带明细，别让 agent 以为只管下发
    expect(cards).toContain('不要凭记忆编指令');     // 防幻觉的核心纪律
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

  it('取过哪类知识包都不影响 apply（无会话账本）', async () => {
    // 用 write_construction 备稿，需 byok 面
    const client = await openClient({ toolset: 'byok' });
    // 先取题目增强（category 只用来选知识包）
    await client.callTool({ name: 'get_expert_prompt', arguments: { category: 'A' } });
    await client.callTool({
      name: 'write_construction',
      arguments: { commands: ['A = (0, 0)', 'B = (1, 1)'] },
    });
    // apply 不带类别（2026-10-15 起写路径与类别彻底解耦），也不会把上面那次分类记下来
    const r = await client.callTool({ name: 'ggb_apply', arguments: { png: false } });
    expect(textBlocks(r).some((t) => t.includes('已按类别'))).toBe(false);
  });

  it('ggb_apply 报告无效行但**不剔除**——它们还在工作稿里', async () => {
    // 剔了 daemon 会把净化后的账本回写工作稿，agent 刚写的那行就从它自己的文件里消失。
    // 而 apply 是「每完成一段就调一次」的高频动作，等于在它编辑到一半时抽走它脚下的行。
    const client = await openClient({ toolset: 'byok' });
    const commands = ['A = (0, 0)', 'Tangnet(A, 1)'];
    await client.callTool({ name: 'write_construction', arguments: { commands } });
    const r = await client.callTool({ name: 'ggb_apply', arguments: { png: false } });
    const texts = textBlocks(r);
    // 问题行放第一条（别埋在一堆 text 块中间），且明说没替它删
    expect(texts[0]).toContain('Tangnet(A, 1)');
    expect(texts[0]).toContain('没有替你删');
    // 文件没被动过
    const read = await client.callTool({ name: 'read_construction', arguments: {} });
    expect(textBlocks(read).some((t) => t.includes('Tangnet(A, 1)'))).toBe(true);
  });

  it('异步工具面（真 agent 走的 HTTP 路径）：read/write/apply 都不崩', async () => {
    // tools-http 的 readConstruction 返回 Promise。漏 await 时 read_construction 会拿
    // Promise.length 当数组长度、恒报「工作稿为空」——同步 GgbTools 测不出来，必须走异步包装。
    const client = await openClient({ wrapAsync: true, toolset: 'byok' });
    await client.callTool({
      name: 'write_construction',
      arguments: { commands: ['A = (0, 0)', 'B = (1, 1)'] },
    });
    const read = await client.callTool({ name: 'read_construction', arguments: {} });
    expect(textBlocks(read).some((t) => t.includes('A = (0, 0)'))).toBe(true);
    expect(textBlocks(read).some((t) => t.includes('工作稿为空'))).toBe(false);
    const apply = await client.callTool({ name: 'ggb_apply', arguments: { png: false } });
    expect(textBlocks(apply).some((t) => t.includes('对象') || t.includes('构造'))).toBe(true);
  });
});
