/**
 * 题目图片的准入规则 —— 一份，三处（上传按钮 / 粘贴 / 拖入）共用。
 *
 * 为什么单独成文件：规则原来散在两处、文案各写各的——`AssistantChatComposer.addImages`
 * 管上限与文案，`imageAdapter.add` 管类型与大小。接入 assistant-ui 的
 * `ComposerPrimitive.AttachmentDropzone` 之后，**拖入这条路根本不经过 `addImages`**
 * （dropzone 自己调 `aui.composer.addAttachment`），规则只有落在 **adapter** 里三条路才一致。
 * 于是把规则收进 adapter，文案收进这里。
 *
 * 错误怎么回到界面：adapter 抛出的 message 会被库装进 `composer.attachmentAddError` 事件
 * （`reason: 'adapter-error'`），由 `AssistantChatComposer` 订阅后显示——不再是本地 state。
 * 所以这里的文案就是**用户看到的文案**，改动要连着守卫一起看。
 */

/** 一次最多几张题图（含还在读取的）。 */
export const ATTACHMENT_LIMIT = 4;
export const ATTACHMENT_LIMIT_MESSAGE = '一次最多添加 4 张题目图片。';

export const ATTACHMENT_FORMAT_MESSAGE = '请使用 PNG、JPEG、WebP 或 GIF 图片。';
export const ATTACHMENT_SIZE_MESSAGE = '单张题目图片不能超过 6 MB。';
/** agent 没有图片通道时（拖入已被 dropzone 的 disabled 挡住，这里兜的是粘贴与上传）。 */
export const ATTACHMENT_CHANNEL_MESSAGE = '当前 Agent 没有图片通道，请用文字描述题目。';

export const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
/** 给 `<input accept>` 与 attachment adapter 的 `accept` 用。 */
export const ATTACHMENT_ACCEPT = ATTACHMENT_TYPES.join(',');
export const ATTACHMENT_MAX_BYTES = 6 * 1024 * 1024;

export function isSupportedAttachmentType(type: string): boolean {
  return (ATTACHMENT_TYPES as readonly string[]).includes(type);
}

/**
 * 已经占掉的名额 = 库里现有的 + **正在读取、还没落进库的**。
 *
 * 后半截不能省：同一批文件是**并发** `add` 的（库的 dropzone 与 AddAttachment 都是
 * `Promise.all`），先看库里长度会把同批的后几张漏算——实测一次传 5 张时旧实现靠
 * `pendingAdds` 占位才数得对，这里把那套占位逻辑原样搬进 adapter。
 */
export function attachmentSlots(
  attachments: readonly { file?: File }[],
  pending: ReadonlyMap<File, number>,
): number {
  let slots = attachments.length;
  for (const [file, reserved] of pending) {
    slots += Math.max(0, reserved - attachments.filter((item) => item.file === file).length);
  }
  return slots;
}
