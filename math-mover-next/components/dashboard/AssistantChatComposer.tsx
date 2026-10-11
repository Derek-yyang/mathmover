'use client';

import { useRef, useState } from 'react';
import { AttachmentPrimitive, ComposerPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { ArrowUp, ImagePlus, Square, X } from 'lucide-react';
import { useImagePreview } from './ImagePreview';
import ComposerModelPicker, { type PickableModel } from './ComposerModelPicker';
import ComposerEffortPicker, { type EffortOption } from './ComposerEffortPicker';

export default function AssistantChatComposer({ canAttachImages, isLoading, onStopRun, getAttachmentCount,
  models = [], modelSource, selectedModel, onSelectModel, supportsCustomModel = true,
  reasoningOptions, selectedEffort, onSelectEffort }: {
  canAttachImages: boolean; isLoading: boolean; onStopRun?: () => void; getAttachmentCount: () => number;
  /** 该 agent 可选的模型；空数组或「只有默认且不能手填」时不渲染控件 */
  models?: PickableModel[];
  modelSource?: 'live' | 'fallback';
  selectedModel?: string;
  onSelectModel?: (id: string) => void;
  supportsCustomModel?: boolean;
  /** 当前模型的推理档位；只有一项或没有时不渲染 */
  reasoningOptions?: EffortOption[];
  selectedEffort?: string;
  onSelectEffort?: (id: string) => void;
}) {
  const aui = useAui();
  const preview = useImagePreview();
  const input = useRef<HTMLInputElement>(null);
  const pendingAdds = useRef(0);
  const [attachmentError, setAttachmentError] = useState('');
  const [dragging, setDragging] = useState(false);
  const hasAttachments = useAuiState(s => s.composer.attachments.length > 0);
  const incompatibleAttachments = hasAttachments && !canAttachImages;
  const addImages = async (files: File[]) => {
    if (!canAttachImages) { setAttachmentError('当前 Agent 没有图片通道，请切换 Agent 或用文字描述题目。'); return; }
    setAttachmentError('');
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { setAttachmentError('请使用 PNG、JPEG、WebP 或 GIF 图片。'); continue; }
      if (file.size > 6 * 1024 * 1024) { setAttachmentError('单张题目图片不能超过 6 MB。'); continue; }
      if (getAttachmentCount() + pendingAdds.current >= 4) { setAttachmentError('一次最多添加 4 张题目图片。'); break; }
      pendingAdds.current++;
      try { await aui.composer.addAttachment(file); }
      catch (error) { setAttachmentError(error instanceof Error ? error.message : '图片读取失败，请重试。'); }
      finally { pendingAdds.current--; }
    }
  };
  return <div className="shrink-0 px-3 pt-2 pb-3">
    <ComposerPrimitive.Root aria-label="题目输入区"
      className={`rounded-2xl border bg-white p-3 transition-colors motion-reduce:transition-none focus-within:border-emerald-600 ${dragging ? 'border-emerald-600 bg-emerald-50' : 'border-stone-300'}`}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); setDragging(false); void addImages(Array.from(event.dataTransfer.files)); } }}>
      {hasAttachments && <div aria-label="待发送图片" className="mb-3 flex items-start gap-2 overflow-x-auto overflow-y-hidden">
        <ComposerPrimitive.Attachments>{({ attachment }) => {
          const part = attachment.content?.find(part => part.type === 'image');
          return <AttachmentPrimitive.Root className="relative h-16 w-16 shrink-0 rounded-lg border border-stone-200 bg-stone-50">
            <button type="button" aria-label={`预览待发送图片：${attachment.name}`} title={attachment.name} className="block h-full w-full overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-700"
              disabled={part?.type !== 'image'} onClick={() => {
                const attachments = aui.composer().getState().attachments;
                const images = attachments.map(item => { const content = item.content?.find(part => part.type === 'image'); return { url: content?.type === 'image' ? content.image : '', name: item.name }; });
                preview(images, attachments.findIndex(item => item.id === attachment.id));
              }}>
              {part?.type === 'image' && <img src={part.image} alt={attachment.name} className="h-full w-full object-cover" />}
            </button>
            <AttachmentPrimitive.Remove aria-label={`移除图片：${attachment.name}`} title="移除图片" className="absolute top-1 right-1 rounded-full border border-stone-300 bg-white p-1 text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700"><X aria-hidden className="h-3 w-3" /></AttachmentPrimitive.Remove>
          </AttachmentPrimitive.Root>;
        }}</ComposerPrimitive.Attachments>
      </div>}
      <ComposerPrimitive.Input aria-label="题目描述" placeholder="输入题目，或粘贴题目截图…" minRows={1} maxRows={8}
        submitMode={incompatibleAttachments ? 'none' : 'enter'}
        addAttachmentOnPaste={false}
        onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void addImages(files); } }}
        className="block w-full resize-none bg-transparent text-sm leading-6 text-stone-800 placeholder:text-stone-600 focus:outline-none" />
      <div className="mt-2 flex items-center justify-between gap-2">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={!canAttachImages} className="hidden"
          onChange={event => { void addImages(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <div className="flex min-w-0 items-center gap-1">
          <button type="button" aria-label="添加题目图片" title={canAttachImages ? '上传、粘贴或拖入题目图片' : '当前 Agent 没有图片通道'}
            disabled={!canAttachImages} onClick={() => input.current?.click()} className="shrink-0 rounded-lg p-2 text-stone-600 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:text-stone-400"><ImagePlus aria-hidden className="h-4 w-4" /></button>
          {/* 模型选择器放在工具栏里（挨着附件/发送），不放聊天区头部——「随手换模型」
              的视线就在输入框。只有该 agent 真能选时才显示：只有一项「默认」且
              不能手填（dsh）时整个控件藏掉，给一个只有一项的下拉是噪音。 */}
          {(models.length > 1 || (models.length > 0 && supportsCustomModel)) && (
            <ComposerModelPicker models={models} source={modelSource} loading={isLoading && models.length === 0}
              selectedId={selectedModel ?? 'default'} onSelect={id => onSelectModel?.(id)} />
          )}
          {/* 档位跟着当前模型走：换个模型档位集就变了。只有一项时不渲染（控件自己判）。 */}
          <ComposerEffortPicker options={reasoningOptions ?? []} selectedId={selectedEffort}
            onSelect={id => onSelectEffort?.(id)} disabled={isLoading} />
        </div>
        {/* 运行中换成停止按钮——原来只是转圈的发送键，看着能点、点了没反应。
            两颗按钮共用几何与叠放位，靠透明度交叉过渡，读起来是「同一颗按钮变了状态」
            而不是「跳出一个新控件」。用浅绿底与深绿图标呼应主题：停止一轮不是破坏性操作，
            已生成的内容与画布都保留；红色在这套奶油底+emerald 的色板里也是异物。 */}
        <div className="relative h-8 w-8 shrink-0">
          <button type="button" tabIndex={isLoading ? 0 : -1} aria-hidden={!isLoading}
            onClick={() => onStopRun?.()} aria-label="停止本轮" title="停止本轮（agent 正在运行）"
            className={`absolute inset-0 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 transition-opacity duration-150 motion-reduce:transition-none ${isLoading ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
            <Square aria-hidden className="h-3.5 w-3.5 fill-current" />
          </button>
          <ComposerPrimitive.Send tabIndex={isLoading ? -1 : 0} aria-hidden={isLoading}
            disabled={isLoading || incompatibleAttachments} aria-label="发送消息" title="发送消息"
            className={`absolute inset-0 flex items-center justify-center rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500 transition-opacity duration-150 motion-reduce:transition-none ${isLoading ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
            <ArrowUp aria-hidden size={18} strokeWidth={2.25} />
          </ComposerPrimitive.Send>
        </div>
      </div>
    </ComposerPrimitive.Root>
    {attachmentError && <p role="alert" className="mt-2 text-xs leading-5 text-amber-900">{attachmentError}</p>}
    {!canAttachImages && <p role={incompatibleAttachments ? 'alert' : undefined} className="mt-2 text-xs leading-5 text-stone-600">{incompatibleAttachments ? '当前 Agent 没有图片通道，请移除图片或切换 Agent 后发送。' : '当前 Agent 没有图片通道，请用文字描述题目。'}</p>}
  </div>;
}
