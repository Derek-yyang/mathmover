'use client';

import { useId, useState } from 'react';
import { AttachmentPrimitive, ComposerPrimitive, useAui, useAuiEvent, useAuiState } from '@assistant-ui/react';
import { ArrowUp, ImagePlus, Square, X } from 'lucide-react';
import { useImagePreview } from './ImagePreview';
import ComposerModelPicker, { type PickableModel } from './ComposerModelPicker';
import {
  ATTACHMENT_CHANNEL_MESSAGE, ATTACHMENT_FORMAT_MESSAGE, ATTACHMENT_LIMIT_MESSAGE,
} from '@/lib/attachment-policy';
import type { EffortOption } from '@/lib/agent-picker';
import type { SendBlock } from '@/lib/agent-send-readiness';

export default function AssistantChatComposer({ canAttachImages, isLoading, onStopRun,
  sendBlock, onResolveSendBlock,
  models = [], modelSource, selectedModel, onSelectModel,
  reasoningOptions, selectedEffort, onSelectEffort }: {
  canAttachImages: boolean; isLoading: boolean; onStopRun?: () => void;
  sendBlock?: SendBlock; onResolveSendBlock?: () => void;
  /** 该 agent 可选的模型（= agent 配置里的全部）；只有一项时不渲染控件 */
  models?: PickableModel[];
  modelSource?: 'live' | 'fallback';
  selectedModel?: string;
  onSelectModel?: (id: string) => void;
  /** 当前模型的推理档位；只有一项或没有时不渲染 */
  reasoningOptions?: EffortOption[];
  selectedEffort?: string;
  onSelectEffort?: (id: string) => void;
}) {
  const aui = useAui();
  const sendBlockId = useId();
  const preview = useImagePreview();
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentLimitExceeded, setAttachmentLimitExceeded] = useState(false);
  const attachmentCount = useAuiState(s => s.composer.attachments.length);
  const hasAttachments = attachmentCount > 0;
  const attachmentsNotReady = useAuiState(s => s.composer.attachments.some(item => item.status.type === 'running' || item.status.type === 'incomplete'));
  const incompatibleAttachments = hasAttachments && !canAttachImages;

  /**
   * 三条入口（上传按钮 / 粘贴 / 拖入）现在**全部由库接管**，都走
   * `aui.composer.addAttachment`；校验（类型/大小/上限）与文案统一在 attachment adapter 里
   * （见 lib/attachment-policy.ts）。所以这个组件不再自己收文件，只负责显示结果。
   */
  useAuiEvent('composer.attachmentAddError', ({ reason, message }) => {
    const text = reason === 'not-accepted' ? ATTACHMENT_FORMAT_MESSAGE
      : reason === 'no-adapter' ? ATTACHMENT_CHANNEL_MESSAGE
      : message;
    // 没有图片通道时面板下方已有常驻说明；粘贴那条会再报一次同一句，别叠
    if (!canAttachImages && text === ATTACHMENT_CHANNEL_MESSAGE) return;
    // 上限那条单开一个状态：它要**跟着张数一起消失**（移除一张后就不该再提示），
    // 所以渲染处还要再判一次 attachmentCount（见下），不是普通的常驻错误。
    if (text === ATTACHMENT_LIMIT_MESSAGE) {
      setAttachmentLimitExceeded(true);
      setAttachmentError('');
      return;
    }
    setAttachmentError(text);
    setAttachmentLimitExceeded(false);
  });
  // 成功加进一张就清掉上一次的提示——否则「补一张合法的图」会把已解决的警告唤醒
  useAuiEvent('composer.attachmentAdd', () => {
    setAttachmentError('');
    setAttachmentLimitExceeded(false);
  });
  return <div className="shrink-0 px-3 pt-2 pb-3">
    <ComposerPrimitive.Root aria-label="题目输入区"
      className="rounded-2xl border border-[var(--mm-border-stone-300)] bg-[var(--mm-surface)] p-3 transition-colors motion-reduce:transition-none focus-within:border-[var(--mm-border-emerald-600)]">
      {hasAttachments && <div aria-label="待发送图片" className="mb-3 flex items-start gap-2 overflow-x-auto overflow-y-hidden">
        <ComposerPrimitive.Attachments>{({ attachment }) => {
          const part = attachment.content?.find(part => part.type === 'image');
          return <AttachmentPrimitive.Root className="relative h-16 w-16 shrink-0 rounded-lg border border-[var(--mm-border-stone-200)] bg-[var(--mm-bg-stone-50)]">
            <button type="button" aria-label={`预览待发送图片：${attachment.name}`} title={attachment.name} className="block h-full w-full overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)]"
              disabled={part?.type !== 'image'} onClick={() => {
                const attachments = aui.composer().getState().attachments;
                const images = attachments.map(item => { const content = item.content?.find(part => part.type === 'image'); return { url: content?.type === 'image' ? content.image : '', name: item.name }; });
                preview(images, attachments.findIndex(item => item.id === attachment.id));
              }}>
              {part?.type === 'image' && <img src={part.image} alt={attachment.name} className="h-full w-full object-cover" />}
            </button>
            <AttachmentPrimitive.Remove aria-label={`移除图片：${attachment.name}`} title="移除图片" className="absolute top-1 right-1 rounded-full border border-[var(--mm-border-stone-300)] bg-[var(--mm-surface)] p-1 text-[var(--mm-text-stone-700)] hover:bg-[var(--mm-bg-stone-100)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)]"><X aria-hidden className="h-3 w-3" /></AttachmentPrimitive.Remove>
          </AttachmentPrimitive.Root>;
        }}</ComposerPrimitive.Attachments>
      </div>}
      <ComposerPrimitive.Input aria-label="题目描述" placeholder="输入题目，或粘贴题目截图…" minRows={1} maxRows={8}
        aria-describedby={!isLoading && sendBlock ? sendBlockId : undefined}
        submitMode={sendBlock || incompatibleAttachments || attachmentsNotReady ? 'none' : 'enter'}
        className="block w-full resize-none bg-transparent text-sm leading-6 text-[var(--mm-text-stone-800)] placeholder:text-[var(--mm-text-stone-600)] focus:outline-none" />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {/* 上传入口用库的 `AddAttachment`：它自己造一个临时 input、`accept` 取自
              adapter 的 `attachmentAccept`（不和我们那份类型表分叉）、支持多选，
              用户取消时还会把那个临时 input 摘掉。我们只留外观与无障碍属性。 */}
          <ComposerPrimitive.AddAttachment aria-label="添加题目图片"
            title={canAttachImages ? '上传、粘贴或拖入题目图片' : '当前 Agent 没有图片通道'}
            disabled={!canAttachImages}
            className="shrink-0 rounded-lg p-2 text-[var(--mm-text-stone-600)] hover:bg-[var(--mm-bg-stone-100)] focus-visible:outline-2 focus-visible:outline-[var(--mm-border-emerald-700)] disabled:cursor-not-allowed disabled:text-[var(--mm-text-stone-400)]">
            <ImagePlus aria-hidden className="h-4 w-4" />
          </ComposerPrimitive.AddAttachment>
          {/* 模型 + 推理档位的组合面板放在工具栏里（挨着附件/发送），不放聊天区
              头部——「随手换」的视线就在输入框。模型或档位有多个选项时才显示；
              档位是模型的属性，跟模型同面板。 */}
          {models.length > 0 && (models.length > 1 || (reasoningOptions?.length ?? 0) > 1) && (
            <ComposerModelPicker models={models} source={modelSource} loading={isLoading && models.length === 0}
              selectedId={selectedModel ?? 'default'} onSelect={id => onSelectModel?.(id)}
              reasoningOptions={reasoningOptions} selectedEffort={selectedEffort} onSelectEffort={id => onSelectEffort?.(id)} />
          )}
        </div>
        {/* 运行中换成停止按钮——原来只是转圈的发送键，看着能点、点了没反应。
            两颗按钮共用几何与叠放位，靠透明度交叉过渡，读起来是「同一颗按钮变了状态」
            而不是「跳出一个新控件」。用浅绿底与深绿图标呼应主题：停止一轮不是破坏性操作，
            已生成的内容与画布都保留；红色在这套奶油底+emerald 的色板里也是异物。 */}
        <div className="relative h-8 w-8 shrink-0">
          <button type="button" tabIndex={isLoading ? 0 : -1} aria-hidden={!isLoading}
            onClick={() => onStopRun?.()} aria-label="停止本轮" title="停止本轮（agent 正在运行）"
            className={`absolute inset-0 flex items-center justify-center rounded-lg bg-[var(--mm-bg-emerald-50)] text-[var(--mm-text-emerald-700)] hover:bg-[var(--mm-bg-emerald-100)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)] transition-opacity duration-150 motion-reduce:transition-none ${isLoading ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
            <Square aria-hidden className="h-3.5 w-3.5 fill-current" />
          </button>
          <ComposerPrimitive.Send tabIndex={isLoading ? -1 : 0} aria-hidden={isLoading}
            disabled={isLoading || !!sendBlock || incompatibleAttachments || attachmentsNotReady} aria-label="发送消息" title={sendBlock?.message ?? '发送消息'}
            aria-describedby={!isLoading && sendBlock ? sendBlockId : undefined}
            className={`absolute inset-0 flex items-center justify-center rounded-lg bg-[var(--mm-bg-emerald-700)] text-white hover:bg-[var(--mm-bg-emerald-800)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)] disabled:cursor-not-allowed disabled:bg-[var(--mm-bg-stone-100)] disabled:text-[var(--mm-text-stone-500)] transition-opacity duration-150 motion-reduce:transition-none ${isLoading ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
            <ArrowUp aria-hidden size={18} strokeWidth={2.25} />
          </ComposerPrimitive.Send>
        </div>
      </div>
    </ComposerPrimitive.Root>
    {/* Transient prerequisites stay available to assistive technology and the
        send tooltip; only actionable problems need a visible notice. */}
    {!isLoading && sendBlock && <div id={sendBlockId} className={sendBlock.action
      ? 'mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-5 text-[var(--mm-text-stone-600)]'
      : 'sr-only'}>
      <span role="status">{sendBlock.message}</span>
      {sendBlock.action && onResolveSendBlock && <button type="button" onClick={onResolveSendBlock}
        className="rounded text-[var(--mm-text-emerald-800)] underline underline-offset-4 hover:text-[var(--mm-text-emerald-900)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mm-border-emerald-700)]">
        {sendBlock.action === 'reconnect' ? '重新连接' : sendBlock.action === 'settings' ? '打开设置' : '重新检测'}
      </button>}
    </div>}
    {attachmentError && <p role="alert" className="mt-2 text-xs leading-5 text-[var(--mm-text-amber-900)]">{attachmentError}</p>}
    {attachmentLimitExceeded && attachmentCount >= 4 && <p role="alert" className="mt-2 text-xs leading-5 text-[var(--mm-text-amber-900)]">{ATTACHMENT_LIMIT_MESSAGE}</p>}
    {!canAttachImages && <p role={incompatibleAttachments ? 'alert' : undefined} className="mt-2 text-xs leading-5 text-[var(--mm-text-stone-600)]">{incompatibleAttachments ? '当前 Agent 没有图片通道，请移除图片或切换 Agent 后发送。' : '当前 Agent 没有图片通道，请用文字描述题目。'}</p>}
  </div>;
}
