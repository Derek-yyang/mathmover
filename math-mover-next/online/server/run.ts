import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { del } from '@vercel/blob';
import { GgbTools, DEFAULT_TOOLS_CONFIG, writeConstructionFile } from '../../../packages/daemon/src/tools.ts';
import { listenTools } from './tool-http';
import { buildOpenCodeConfigContent, createOpenCodeEnvironment, createOpenCodeStatusPlugin, openCodePaths,
  runAgent, opencode, opencodeModelId, resolveRuntimeTarget, validateImages, buildTranscript, createTitleExtractor, OPENCODE_BYOK_API_KEY_ENV,
  type AgentEvent, type TranscriptTurn } from '@mathmover/agent-runtime';
import { buildSystemBrief } from '@/lib/server/system-brief';
import { resolveRunConfig } from './config';
import { normalizeOnlineReasoningEffort, ONLINE_REASONING_EFFORTS } from '../model-config';
import { CanvasChannel } from './channel';
import { listenProviderProxy } from './provider-proxy';

export interface RunInput {
  text?: string;
  images?: unknown;
  commands?: string[];
  history?: TranscriptTurn[];
  provider?: unknown;
  reasoningEffort?: unknown;
}

/**
 * OpenCode's free Console models are only available to requests made by the
 * OpenCode runtime itself. A loopback image bridge makes the request originate
 * from our server instead, which the provider rejects as an external client.
 */
function usesOpenCodeFreeTier(config: ReturnType<typeof resolveRunConfig>): boolean {
  if (config.apiFormat !== 'openai-chat' || !config.model.endsWith('-free')) return false;
  try {
    return new URL(config.baseUrl).hostname === 'opencode.ai';
  } catch {
    return false;
  }
}

function assetDirectory() {
  const found = ['runtime', 'online/runtime', 'math-mover-next/online/runtime'].map(relative => path.resolve(process.cwd(), relative))
    .find(candidate => existsSync(path.join(candidate, 'mcp.cjs')));
  if (!found) throw new Error('云端运行资源缺失，请重新部署。');
  return found;
}

/** Deployment smoke check; no provider request or credentials required. */
export async function probeOnlineRuntime() {
  const target = resolveRuntimeTarget(opencode);
  if (!target) throw new Error('云端内置 Agent 可执行文件缺失。');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mathmover-probe-'));
  try {
    const { stdout } = await promisify(execFile)(target.command, [...target.prefixArgs, '--version'], {
      env: createOpenCodeEnvironment(directory, { NODE_ENV: process.env.NODE_ENV ?? 'production' }),
      timeout: 15000, maxBuffer: 64000, windowsHide: true,
    });
    return { version: stdout.trim(), knowledgeReady: buildSystemBrief(assetDirectory()).length > 0 };
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

export function validateRun(input: RunInput) {
  if (!input || typeof input !== 'object' || (input.text !== undefined && typeof input.text !== 'string')) throw new Error('请求格式无效。');
  const text = input.text?.trim() ?? '';
  if (text.length > 16000) throw new Error('问题描述过长。');
  const images = validateImages(input.images);
  if (images.error) throw new Error(images.error);
  if (!text && !images.images.length) throw new Error('请输入问题或添加题图。');
  if (input.commands !== undefined && (!Array.isArray(input.commands) || input.commands.length > 5000 || input.commands.some(c => typeof c !== 'string' || c.length > 16000))) throw new Error('构造清单无效。');
  if (input.history !== undefined && (!Array.isArray(input.history) || input.history.length > 100 || input.history.some(t => !t || !['user', 'assistant'].includes(t.role) || typeof t.content !== 'string') || JSON.stringify(input.history).length > 240000)) throw new Error('对话历史过长或格式无效。');
  return { text, images: images.images, commands: input.commands ?? [], history: input.history ?? [] };
}

/** Everything here belongs to one run and is discarded after exit. No courseware store or shared OpenCode DB. */
export async function runOnline(channel: CanvasChannel, input: RunInput, signal: AbortSignal) {
  const checked = validateRun(input);
  const cfg = resolveRunConfig(input.provider);
  // The hosted experience is fixed at low. User-owned models keep their provider default.
  const reasoningEffort = input.provider === undefined
    ? normalizeOnlineReasoningEffort(input.reasoningEffort)
    : undefined;
  signal.throwIfAborted();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mathmover-online-'));
  const workdir = path.join(directory, 'work');
  let http: Awaited<ReturnType<typeof listenTools>> | undefined;
  let handle: ReturnType<typeof runAgent> | undefined;
  let statusPlugin: ReturnType<typeof createOpenCodeStatusPlugin> | undefined;
  let providerProxy: Awaited<ReturnType<typeof listenProviderProxy>> | undefined;
  const uploadedImageUrls: string[] = [];
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let failureMessage = '';
  let consecutiveToolErrors = 0;
  const cancel = () => { handle?.cancel(); };
  const failRun = (message: string) => {
    if (!failureMessage) failureMessage = message;
    handle?.cancel();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const toolsConfig = { ...DEFAULT_TOOLS_CONFIG, workdir };
    writeConstructionFile(toolsConfig, checked.commands);
    const directProvider = usesOpenCodeFreeTier(cfg);
    if (checked.images.length && !directProvider && !process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error('题图临时存储未配置，暂时只能发送文字。');
    }
    if (!directProvider) {
      providerProxy = await listenProviderProxy(cfg, url => uploadedImageUrls.push(url));
    }
    const tools = new GgbTools(channel, toolsConfig);
    http = await listenTools(tools);
    const assetRoot = assetDirectory();
    const mcpEntry = path.join(assetRoot, 'mcp.cjs');
    const env = createOpenCodeEnvironment(directory);
    // Do not pass deployment credentials unrelated to this run into the Agent.
    for (const key of Object.keys(env)) {
      if (/^(?:VERCEL_|MATHMOVER_ONLINE_|AWS_|.*(?:TOKEN|SECRET|API_KEY|PASSWORD)$)/i.test(key)) env[key] = undefined;
    }
    statusPlugin = createOpenCodeStatusPlugin(openCodePaths(directory).temp);
    const config = JSON.parse(buildOpenCodeConfigContent({
      provider: {
        ...cfg,
        baseUrl: providerProxy?.url ?? cfg.baseUrl,
        reasoningLevels: ONLINE_REASONING_EFFORTS.map(level => level.id),
      },
      statusPluginUrl: statusPlugin.url,
      mcp: { command: process.execPath, args: [mcpEntry], env: {
        MATHMOVER_DAEMON_URL: http.url, MATHMOVER_ROOT: assetRoot,
        MATHMOVER_WINDOW_ID: '', MATHMOVER_COURSEWARE_ID: '',
      } },
    })!);
    config.permission = { ...config.permission, external_directory: 'deny', webfetch: 'deny' };
    const extractor = createTitleExtractor();
    const publish = (event: AgentEvent) => {
      // Tool inputs/results contain images and file contents. The UI needs only progress metadata.
      if (event.kind === 'raw' || event.kind === 'session' || event.kind === 'thinking') return;
      for (const e of extractor.push(event)) {
        channel.send({ type: 'event', event: e.kind === 'tool-call' ? { kind: e.kind, name: e.name, toolCallId: e.toolCallId }
          : e.kind === 'tool-result' ? { kind: e.kind, toolCallId: e.toolCallId, isError: e.isError } : e });
        if (e.kind === 'tool-result') {
          consecutiveToolErrors = e.isError ? consecutiveToolErrors + 1 : 0;
          if (consecutiveToolErrors >= 2) {
            failRun('连续两次工具调用失败，本轮已停止。请缩小题目范围，或换用工具调用更稳定的模型。');
          }
        }
      }
    };
    const history = checked.history.length ? `此前对话：\n${buildTranscript(checked.history)}\n\n` : '';
    const prompt = `${buildSystemBrief(assetRoot)}\n\n${history}` +
      `工作稿路径：${path.join(workdir, 'construction.ggb.txt')}\n` +
      '回答最前面先输出一次 <mm-title>2至8字标题</mm-title>，随后正常回答。\n' +
      `用户现在说：\n${checked.text || '请根据题图构建动态图形。'}`;
    signal.throwIfAborted();
    handle = runAgent({ def: opencode, prompt, cwd: workdir, images: checked.images,
      mcpConfigPath: path.join(directory, 'unused-mcp.json'),
      reasoningEffort,
      env: { ...env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config), [OPENCODE_BYOK_API_KEY_ENV]: cfg.apiKey,
        MATHMOVER_WINDOW_ID: '', MATHMOVER_COURSEWARE_ID: '' },
      inactivityTimeoutMs: 120000, firstOutputTimeoutMs: 90000, onEvent: publish });
    deadline = setTimeout(() => failRun('本次生成达到体验时限，请缩小题目范围后继续。'), 280000);
    await handle.done;
    for (const event of extractor.flush()) channel.send({ type: 'event', event });
    if (failureMessage) throw new Error(failureMessage);
  } finally {
    clearTimeout(deadline); signal.removeEventListener('abort', cancel);
    if (signal.aborted) handle?.cancel();
    statusPlugin?.cleanup();
    providerProxy?.server.closeAllConnections();
    if (providerProxy) await new Promise<void>(resolve => providerProxy!.server.close(() => resolve()));
    http?.server.closeAllConnections();
    if (http) await new Promise<void>(resolve => http!.server.close(() => resolve()));
    if (uploadedImageUrls.length) {
      try { await del(uploadedImageUrls); } catch { /* Best-effort cleanup for unreachable temporary images. */ }
    }
    // directory is the mkdtemp result, never supplied by a client.
    await fs.rm(directory, { recursive: true, force: true });
  }
}
