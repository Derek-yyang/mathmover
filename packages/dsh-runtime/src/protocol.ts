export const PROTOCOL_VERSION = 1 as const;
export const RUNTIME_NAME = 'mathmover' as const;
export const CAPABILITIES = {
  session_resume: true,
  session_cancel: true,
  structured_events: true,
} as const;

export type ModelCatalogEntry = {
  provider: string;
  provider_name: string;
  id: string;
  name: string;
  reasoning_options?: Array<{ id: string; name: string; default?: boolean }>;
};

export function modelsFrame(models: ModelCatalogEntry[]) {
  return {
    v: PROTOCOL_VERSION,
    type: 'models' as const,
    runtime: RUNTIME_NAME,
    models,
  };
}

export type ExecuteCommand = {
  v: 1;
  type: 'execute';
  request_id: string;
  cwd: string;
  prompt: string;
  resume_session_id?: string;
  model?: { provider: string; id: string };
  reasoning_effort?: string;
  mcp_servers: unknown[];
  /**
   * MathMover 扩展（上游帧没有此项）：随题的图片。
   * 交给 attachment 服务入库拿 ref，再拼进用户消息的内容块。
   * 形状对齐 @deepseek-ai/dsh-attachment 的 EncodedImageAttachment。
   *
   * **这条通路目前是备用，不是默认。** 2026-10-12 实测对照：
   *   prompt-path（路径写进 prompt、agent 自己读）—— 大小图都行，模型读出了
   *     完整题干与坐标；对 3066px 的图也正常。
   *   inline（本字段）—— 被附件服务的 maxImageDimension=2000 挡住，大图直接失败。
   * 结论：prompt-path 严格更优，故 agent-runtime 里 dsh 的 imageDelivery 留在
   * 'prompt-path'。本字段留作退路——万一哪天读文件工具不再把图交给视觉模型、
   * 或换了个不支持文件读图的模型，inline 是唯一确定的视觉输入通道。
   * 它已实现且真机验过（小图模型能看懂），别当闲置代码删掉。
   */
  images?: Array<{ mediaType: string; data: string; name?: string }>;
};

export type CancelCommand = {
  v: 1;
  type: 'cancel';
  request_id: string;
};

export type HostCommand = ExecuteCommand | CancelCommand;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseHostCommand(value: unknown): HostCommand {
  const input = record(value);
  if (!input || input.v !== 1 || !nonEmpty(input.type) || !nonEmpty(input.request_id)) {
    throw new Error('invalid protocol envelope');
  }
  if (input.type === 'cancel') {
    return { v: 1, type: 'cancel', request_id: input.request_id };
  }
  if (input.type !== 'execute' || !nonEmpty(input.cwd) || !nonEmpty(input.prompt) || !Array.isArray(input.mcp_servers)) {
    throw new Error('invalid execute command');
  }
  const model = record(input.model);
  if (input.model !== undefined && (!model || !nonEmpty(model.provider) || !nonEmpty(model.id))) {
    throw new Error('invalid model selection');
  }
  if (input.resume_session_id !== undefined && !nonEmpty(input.resume_session_id)) {
    throw new Error('invalid resume session id');
  }
  if (input.reasoning_effort !== undefined && !nonEmpty(input.reasoning_effort)) {
    throw new Error('invalid reasoning effort');
  }
  return {
    v: 1,
    type: 'execute',
    request_id: input.request_id,
    cwd: input.cwd,
    prompt: input.prompt,
    mcp_servers: input.mcp_servers,
    ...(input.resume_session_id === undefined ? {} : { resume_session_id: input.resume_session_id }),
    ...(model === null ? {} : { model: { provider: model.provider as string, id: model.id as string } }),
    ...(input.reasoning_effort === undefined ? {} : { reasoning_effort: input.reasoning_effort as string }),
    ...(parseImages(input.images) ? { images: parseImages(input.images) } : {}),
  };
}

/** 图片项校验：只认 { mediaType, data, name? }，data 须为非空 base64 串。非法项整体丢弃（宁缺勿错）。 */
function parseImages(value: unknown): ExecuteCommand['images'] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: NonNullable<ExecuteCommand['images']> = [];
  for (const item of value) {
    const rec = record(item);
    const mediaType = rec ? rec.mediaType : undefined;
    const data = rec ? rec.data : undefined;
    if (typeof mediaType !== 'string' || typeof data !== 'string' || !data) return undefined;
    const name = typeof rec!.name === 'string' && rec!.name ? rec!.name : undefined;
    out.push(name ? { mediaType, data, name } : { mediaType, data });
  }
  return out;
}

export function identityFrame(type: 'probe' | 'ready', pluginVersion: string) {
  return {
    v: PROTOCOL_VERSION,
    type,
    runtime: RUNTIME_NAME,
    protocol_version: PROTOCOL_VERSION,
    plugin_version: pluginVersion,
    capabilities: CAPABILITIES,
  };
}
