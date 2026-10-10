/**
 * runAgent 的图片递送分流 —— 四种通道各自把图送到哪、要不要在 prompt 里说明。
 *
 * 这里重点锁一条曾经真的丢过的行为：**无通道时也要在 prompt 里说「图片未送达」**。
 * 早先 images 会按通道清空，`images.length === 0` 把说明短路成 ''，未送达提示就没了
 * （三家现都有通道，所以是潜伏 bug——靠用例守住，不靠"反正用不到"）。
 */
import { describe, expect, it } from 'vitest';
import { runAgent } from '../src/run.ts';
import type { RuntimeDefinition } from '../src/defs.ts';
import type { ImageInput } from '../src/images.ts';

const png: ImageInput = { mediaType: 'image/png', base64: 'aGVsbG8=', name: '题.png' };

/** 桩 CLI：用 node -e '' 跑一发就退；buildArgs 顺手抓住收到的 prompt。 */
function fakeDef(overrides: Partial<RuntimeDefinition> = {}) {
  let captured: { prompt: string; imagePaths: string[]; inline: ImageInput[] } | null = null;
  const def = {
    id: 'fake-cli',
    displayName: 'Fake CLI',
    executable: process.execPath,
    probeArgs: ['--version'],
    parseLine: () => null,
    buildArgs: (o: { prompt: string; imagePaths?: string[] }) => {
      captured = { prompt: o.prompt, imagePaths: o.imagePaths ?? [], inline: [] };
      return ['-e', ''];
    },
    ...overrides,
  } as unknown as RuntimeDefinition;   // id 是字面量联合，桩用自造 id
  return { def, getCaptured: () => captured };
}

async function run(def: RuntimeDefinition, images?: ImageInput[]) {
  const events: Array<{ kind: string; message?: string }> = [];
  const handle = runAgent({
    def,
    prompt: '画个图',
    mcpConfigPath: 'x.json',
    images,
    onEvent: (e) => events.push(e as { kind: string; message?: string }),
  });
  await handle.done;
  return events;
}

describe('runAgent 图片递送分流', () => {
  it('无通道 + 有图：prompt 里要说「图片未送达」（这条真丢过）', async () => {
    const { def, getCaptured } = fakeDef(); // 不设 imageDelivery
    await run(def, [png]);
    expect(getCaptured()!.prompt).toContain('画个图');
    expect(getCaptured()!.prompt).toContain('图片未送达');
    expect(getCaptured()!.prompt).toContain('1 张');
    // 无通道不该落盘给路径
    expect(getCaptured()!.imagePaths).toEqual([]);
  });

  it('prompt-path + 有图：prompt 带落盘路径，让 agent 自己看', async () => {
    const { def, getCaptured } = fakeDef({ imageDelivery: 'prompt-path' });
    await run(def, [png, png]);
    expect(getCaptured()!.prompt).toContain('已保存到');
    expect(getCaptured()!.prompt).toContain('2 张');
    expect(getCaptured()!.imagePaths.length).toBe(2); // 路径也给 buildArgs（万一用得上）
  });

  it('argv-paths + 有图：路径进 argv，prompt 不加说明', async () => {
    const { def, getCaptured } = fakeDef({ imageDelivery: 'argv-paths' });
    await run(def, [png]);
    expect(getCaptured()!.imagePaths.length).toBe(1);
    expect(getCaptured()!.prompt).not.toContain('已保存到');
    expect(getCaptured()!.prompt).not.toContain('图片未送达');
  });

  it('stdin-json + 有图：不落盘、prompt 不加说明', async () => {
    let inline: ImageInput[] = [];
    const { def, getCaptured } = fakeDef({
      imageDelivery: 'stdin-json',
      promptViaStdin: true,
      formatStdinInput: (prompt, imgs) => {
        inline = imgs ?? [];
        return prompt;
      },
    });
    await run(def, [png]);
    expect(getCaptured()!.imagePaths).toEqual([]); // 走 stdin，不落盘
    expect(getCaptured()!.prompt).not.toContain('已保存到');
    expect(getCaptured()!.prompt).not.toContain('图片未送达');
    expect(inline).toHaveLength(1); // 图块真的递进了 stdin
  });

  it('无通道时不会把图误递进 stdin', async () => {
    let inline: ImageInput[] = [png]; // 哨兵：若没被清空就会残留
    const { def } = fakeDef({
      promptViaStdin: true,
      formatStdinInput: (prompt, imgs) => {
        inline = imgs ?? [];
        return prompt;
      },
    });
    await run(def, [png]);
    expect(inline).toEqual([]);
  });

  it('没图时不加任何说明', async () => {
    const { def, getCaptured } = fakeDef();
    await run(def);
    expect(getCaptured()!.prompt).toBe('画个图');
  });
});
