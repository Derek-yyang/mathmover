import type { ChatAttachment } from '../components/dashboard/types';
import {
  ATTACHMENT_LIMIT, ATTACHMENT_LIMIT_MESSAGE, ATTACHMENT_MAX_BYTES,
  ATTACHMENT_FORMAT_MESSAGE, ATTACHMENT_SIZE_MESSAGE, isSupportedAttachmentType,
} from './attachment-policy';

export interface AgentImagePayload {
  mediaType: string;
  base64: string;
  name?: string;
}

const storedImage = /^\/api\/coursewares\/assets\/[a-f0-9]{64}\.(?:png|jpg|webp|gif)$/;
const readFailure = '题目图片读取失败，请重新添加图片后再发送。';

function readDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (!isSupportedAttachmentType(blob.type)) throw new Error(ATTACHMENT_FORMAT_MESSAGE);
  if (!blob.size) throw new Error(readFailure);
  if (blob.size > ATTACHMENT_MAX_BYTES) throw new Error(ATTACHMENT_SIZE_MESSAGE);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => { reader.abort(); cleanup(); reject(signal?.reason); };
    reader.onload = () => { cleanup(); resolve(String(reader.result)); };
    reader.onerror = () => { cleanup(); reject(new Error(readFailure)); };
    signal?.addEventListener('abort', abort, { once: true });
    reader.readAsDataURL(blob);
  });
}

/** Resolve both fresh uploads and saved courseware images before starting an Agent request. */
export async function prepareAgentImages(
  attachments: readonly ChatAttachment[], signal?: AbortSignal,
): Promise<AgentImagePayload[]> {
  signal?.throwIfAborted();
  if (attachments.length > ATTACHMENT_LIMIT) throw new Error(ATTACHMENT_LIMIT_MESSAGE);
  const images: AgentImagePayload[] = [];
  for (const attachment of attachments) {
    signal?.throwIfAborted();
    if (attachment.unavailable) throw new Error(readFailure);
    let dataUrl = attachment.url;
    if (attachment.file) {
      dataUrl = await readDataUrl(attachment.file, signal);
    } else if (storedImage.test(dataUrl) || dataUrl.startsWith('blob:')) {
      // Saved messages contain an asset URL, not the original File or inline bytes.
      let response: Response;
      try {
        response = await fetch(dataUrl, { signal, credentials: 'same-origin', redirect: 'error' });
      } catch {
        signal?.throwIfAborted();
        throw new Error(readFailure);
      }
      if (!response.ok) throw new Error(readFailure);
      dataUrl = await readDataUrl(await response.blob(), signal);
    }
    signal?.throwIfAborted();
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) throw new Error(readFailure);
    const [, mediaType, base64] = match;
    if (!isSupportedAttachmentType(mediaType)) throw new Error(ATTACHMENT_FORMAT_MESSAGE);
    const bytes = base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    if (base64.length % 4 || bytes <= 0) throw new Error(readFailure);
    if (bytes > ATTACHMENT_MAX_BYTES) throw new Error(ATTACHMENT_SIZE_MESSAGE);
    images.push({ mediaType, base64, name: attachment.name });
  }
  return images;
}
