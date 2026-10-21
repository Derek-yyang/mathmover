/**
 * 工作稿（construction.ggb.txt）与纯追加增量的行为锁定。
 *
 * 裁决（2026-10-13）：文件是 agent 的可编辑工作稿——像改代码一样改，改完
 * ggb_apply() 生效。**getState 不回写**（会冲掉改到一半的草稿）；apply/reset 才回写。
 * 纯追加时走增量（页面不清屏，对象逐个冒出来）。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeConstructionFile,
  readConstructionFile,
  pureAppendDelta,
  GgbTools,
  type ToolsConfig,
} from '../src/tools.ts';
import type { GgbBridgeClient } from '../src/bridge-client.ts';

let dir: string;
const cfg = (): ToolsConfig => ({ workdir: dir, includePng: false, pngMaxEdge: 900 });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-draft-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('工作稿读写', () => {
  it('写后读回：指令原样保留', () => {
    const lines = ['A = (0, 0)', '// 一条注释', 'B = (1, 1)'];
    writeConstructionFile(cfg(), lines);
    expect(readConstructionFile(cfg())).toEqual(lines);
  });

  it('文件不存在时读回空数组，不抛错', () => {
    expect(readConstructionFile(cfg())).toEqual([]);
  });

  it('行中空行与 // 注释保留', () => {
    const lines = ['A = (0, 0)', '', '// 说明', 'B = (1, 1)'];
    writeConstructionFile(cfg(), lines);
    expect(readConstructionFile(cfg())).toEqual(lines);
  });

  it('文件只存指令、不加头注释——agent 的 Read 与 daemon 的读必须同形', () => {
    writeConstructionFile(cfg(), ['A = (0, 0)']);
    const body = fs.readFileSync(path.join(dir, 'construction.ggb.txt'), 'utf8');
    // 同一文件两种长度会让 agent 误判「不同步」——头注释是元凶，不能加
    expect(body).not.toContain('#');
    expect(body.trim()).toBe('A = (0, 0)');
  });

  it('历史版本的 # 头注释读回时被跳过（向后兼容）', () => {
    fs.writeFileSync(path.join(dir, 'construction.ggb.txt'),
      '# 旧版头\n# 旧版说明\n\nA = (0, 0)\n', 'utf8');
    expect(readConstructionFile(cfg())).toEqual(['A = (0, 0)']);
  });
});

describe('pureAppendDelta', () => {
  it('前缀相同且只在后面加行 → 返回新增行', () => {
    expect(pureAppendDelta(['A = (0, 0)'], ['A = (0, 0)', 'B = (1, 1)'])).toEqual(['B = (1, 1)']);
  });

  it('中间改了一行 → null（不是纯追加）', () => {
    expect(pureAppendDelta(['A = (0, 0)'], ['A = (2, 2)', 'B = (1, 1)'])).toBeNull();
  });

  it('删了行 → null', () => {
    expect(pureAppendDelta(['A = (0, 0)', 'B = (1, 1)'], ['A = (0, 0)'])).toBeNull();
  });

  it('空账本首图 → null（首图走全量，需要视图初始化）', () => {
    expect(pureAppendDelta([], ['A = (0, 0)'])).toBeNull();
  });

  it('忽略首尾空白差异', () => {
    expect(pureAppendDelta(['A = (0, 0) '], ['A = (0, 0)', 'B = (1, 1)'])).toEqual(['B = (1, 1)']);
  });
});

function fakeBridge(snapshotCommands: string[] = []) {
  const calls: Array<{ method: string; args: unknown }> = [];
  const bridge = {
    connected: true,
    snapshot: { commands: snapshotCommands } as never,
    call: async (method: string, args: unknown) => {
      calls.push({ method, args });
      if (method === 'apply') {
        return {
          applied: (args as { commands?: string[] }).commands ?? [],
          failedFirstPass: [],
          durationMs: 1,
          state: {
            commands: (args as { ledger?: string[] }).ledger ?? (args as { commands?: string[] }).commands ?? [],
            names: [], objects: {}, sliders: [], png: null, pngSource: 'none', generation: 1,
          },
        };
      }
      return {
        commands: [], names: [], objects: {}, sliders: [], png: null, pngSource: 'none', generation: 0,
      };
    },
  } as unknown as Pick<GgbBridgeClient, 'connected' | 'snapshot' | 'call'>;
  return { bridge, calls };
}

describe('GgbTools.apply 的工作稿与增量', () => {
  it('不传 commands = 读工作稿', async () => {
    writeConstructionFile(cfg(), ['A = (0, 0)', 'B = (1, 1)']);
    const { bridge, calls } = fakeBridge([]);
    const tools = new GgbTools(bridge, cfg());
    await tools.apply();
    const applied = calls.find((c) => c.method === 'apply')!;
    expect(applied.args).toMatchObject({ commands: ['A = (0, 0)', 'B = (1, 1)'] });
  });

  it('工作稿为空时如实报错，且报出绝对路径（agent 的 cwd 未必等于 workdir）', async () => {
    const { bridge } = fakeBridge([]);
    const tools = new GgbTools(bridge, cfg());
    await expect(tools.apply()).rejects.toThrow(/没有可下发的指令/);
    // 只说文件名会让 agent 满仓库找位置（实测浪费 12 次工具调用去猜）
    await expect(tools.apply()).rejects.toThrow(new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(tools.constructionPath).toBe(path.join(dir, 'construction.ggb.txt'));
  });

  it('纯追加 → 走增量：只发新行，但账本是完整清单', async () => {
    const { bridge, calls } = fakeBridge(['A = (0, 0)']);
    const tools = new GgbTools(bridge, cfg());
    const r = await tools.apply(['A = (0, 0)', 'B = (1, 1)']);
    const applied = calls.find((c) => c.method === 'apply')!;
    expect(applied.args).toMatchObject({
      incremental: true,
      commands: ['B = (1, 1)'],
      ledger: ['A = (0, 0)', 'B = (1, 1)'],
    });
    expect(r.incremental).toBe(true);
  });

  it('中间改动 → 全量回放，不带 incremental', async () => {
    const { bridge, calls } = fakeBridge(['A = (0, 0)']);
    const tools = new GgbTools(bridge, cfg());
    const r = await tools.apply(['A = (2, 2)']);
    const applied = calls.find((c) => c.method === 'apply')!;
    expect(applied.args).toMatchObject({ commands: ['A = (2, 2)'] });
    expect((applied.args as { incremental?: boolean }).incremental).toBeFalsy();
    expect(r.incremental).toBeFalsy();
  });

  it('apply 后回写工作稿；getState **不**回写（保住 agent 草稿）', async () => {
    const { bridge } = fakeBridge([]);
    const tools = new GgbTools(bridge, cfg());
    await tools.apply(['A = (0, 0)']);
    expect(readConstructionFile(cfg())).toEqual(['A = (0, 0)']);

    // 模拟 agent 改了草稿但还没 apply
    writeConstructionFile(cfg(), ['A = (0, 0)', 'B = (9, 9)']);
    await tools.getState();
    expect(readConstructionFile(cfg())).toEqual(['A = (0, 0)', 'B = (9, 9)']);
  });

  it('readConstruction / writeConstruction 走同一份文件', async () => {
    const { bridge } = fakeBridge([]);
    const tools = new GgbTools(bridge, cfg());
    tools.writeConstruction(['A = (0, 0)']);
    expect(await tools.readConstruction()).toEqual(['A = (0, 0)']);
  });
});
