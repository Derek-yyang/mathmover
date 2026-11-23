import { ToolLoopAgent, streamText, stepCountIs, tool, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import type { ModelProtocol } from './lib/store';

export type SpikeEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; input: unknown }
  | { type: 'done'; text: string };

interface GgbToolset {
  getState: () => Promise<any>;
  apply: (commands: string[], incremental?: boolean) => Promise<any>;
  reset: () => void;
}

export interface AgentConfig {
  protocol: ModelProtocol;
  baseURL: string;
  apiKey: string;
  model: string;
}

export type RunMode = 'build' | 'modify';

/** 按协议创建语言模型；Base URL 始终由用户控制，便于接中转站。 */
function buildModel(
  config: AgentConfig,
  fetchImpl: typeof fetch,
  name: string,
): LanguageModel {
  const common = { name, baseURL: config.baseURL, apiKey: config.apiKey, fetch: fetchImpl };
  switch (config.protocol) {
    case 'openai-responses': {
      const provider = createOpenAI(common);
      return provider.responses(config.model);
    }
    case 'anthropic': {
      const provider = createAnthropic(common);
      return provider(config.model);
    }
    case 'google': {
      const provider = createGoogleGenerativeAI(common);
      return provider(config.model);
    }
    default: {
      const provider = createOpenAICompatible(common);
      return provider(config.model);
    }
  }
}

function instructions(mode: RunMode) {
  const lines = [
    '你是 MathMover 的 GeoGebra 构造助手，面向中学数学。',
    '收到题目或题图后，先调用 ggb_get_state 读取当前画布。',
    '然后调用 ggb_apply 把 GeoGebra 指令下发到画布。',
    '必须调用工具，不要只在回复里描述构造步骤。',
    'GeoGebra 语法示例：A=(0,0)；c: (x-1)^2+(y-2)^2=4；f(x)=x^2。',
    '如果 apply 回执里有失败行，修正后再次调用 ggb_apply。',
  ];
  if (mode === 'modify') {
    lines.push('这是修改现有图形的请求：保留已有对象，只把新增或需要重定义的指令用 incremental=true 下发。');
  } else {
    lines.push('这是新建图形的请求：用 incremental=false 下发完整指令清单。');
  }
  return lines.join('\n');
}

function createAgent(
  config: AgentConfig,
  mode: RunMode,
  fetchImpl: typeof fetch,
  ggb: GgbToolset,
  onEvent: (event: SpikeEvent) => void,
) {
  return new ToolLoopAgent({
    model: buildModel(config, fetchImpl, 'mathmover'),
    instructions: instructions(mode),
    stopWhen: stepCountIs(8),
    onError: ({ error }) => { console.error('[agent-error]', error); },
    tools: {
      ggb_get_state: tool({
        description: '读取当前 GeoGebra 画布对象、滑块和账本。',
        inputSchema: z.object({}),
        execute: async () => {
          const state = await ggb.getState();
          return {
            generation: state.generation,
            objects: state.objects,
            sliders: state.sliders,
            commands: state.commands,
          };
        },
      }),
      ggb_apply: tool({
        description: '把 GeoGebra 指令应用到画布。incremental=true 表示保留现有对象，只叠加新指令。',
        inputSchema: z.object({
          commands: z.union([z.array(z.string()), z.string()]),
          incremental: z.boolean().optional(),
        }),
        execute: async ({ commands, incremental }) => {
          const lines = (typeof commands === 'string' ? commands.split('\n') : commands)
            .map(line => line.trim())
            .filter(Boolean);
          const isIncremental = incremental === true;
          onEvent({ type: 'tool', name: 'ggb_apply', input: { commands: lines, incremental: isIncremental } });
          const result = await ggb.apply(lines, isIncremental);
          onEvent({
            type: 'tool',
            name: 'ggb_apply-result',
            input: {
              applied: result.applied,
              failed: result.failedFirstPass,
              generation: result.state?.generation,
              objects: Object.keys(result.state?.objects ?? {}),
            },
          });
          return {
            applied: result.applied,
            failedFirstPass: result.failedFirstPass,
            durationMs: result.durationMs,
            generation: result.state?.generation,
            objects: result.state?.objects,
            sliders: result.state?.sliders,
          };
        },
      }),
      ggb_reset: tool({
        description: '清空当前画布和账本。',
        inputSchema: z.object({}),
        execute: async () => {
          ggb.reset();
          return { ok: true };
        },
      }),
    },
  });
}

export async function runAgent(
  config: AgentConfig,
  mode: RunMode,
  text: string,
  imageDataUrl: string | null,
  fetchImpl: typeof fetch,
  ggb: GgbToolset,
  onEvent: (event: SpikeEvent) => void,
  signal?: AbortSignal,
) {
  const agent = createAgent(config, mode, fetchImpl, ggb, onEvent);
  const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mediaType: string }> = [
    { type: 'text', text: text || '请根据题图构建 GeoGebra 图形。' },
  ];
  if (imageDataUrl) {
    content.push({
      type: 'image',
      image: imageDataUrl,
      mediaType: imageDataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
    });
  }

  const result = await agent.stream({
    messages: [{ role: 'user', content }],
    abortSignal: signal,
  });
  for await (const delta of result.textStream) onEvent({ type: 'delta', text: delta });
  const finalText = await result.text;
  onEvent({ type: 'done', text: finalText });
  return finalText;
}

/** 用一次极短的请求验证 Base URL、Key 和模型是否可用。 */
export async function testProvider(config: AgentConfig, fetchImpl: typeof fetch = fetch) {
  const result = streamText({
    model: buildModel(config, fetchImpl, 'mathmover-test'),
    prompt: 'ping',
    maxOutputTokens: 8,
    abortSignal: AbortSignal.timeout(15_000),
  });
  await result.text;
}
