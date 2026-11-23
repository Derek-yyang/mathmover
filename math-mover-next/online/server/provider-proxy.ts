import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { put } from '@vercel/blob';
import type { OnlineModelConfig } from '../model-config';

const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

async function uploadDataImage(value: string) {
  const match = value.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const [, contentType, base64] = match;
  const extension = contentType.split('/')[1].replace('jpeg', 'jpg');
  const blob = await put(
    `mathmover-online/${randomUUID()}/vision.${extension}`,
    Buffer.from(base64, 'base64'),
    { access: 'public', contentType, addRandomSuffix: true, cacheControlMaxAge: 60, ttlDays: 1 },
  );
  return blob.url;
}

async function replaceInlineImages(value: unknown, onUpload: (url: string) => void): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(item => replaceInlineImages(item, onUpload)));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, any>;

  if ((record.type === 'image_url' || record.type === 'input_image') && record.image_url) {
    const url = typeof record.image_url === 'string' ? record.image_url : record.image_url.url;
    if (typeof url === 'string' && url.startsWith('data:image/')) {
      const publicUrl = await uploadDataImage(url);
      if (publicUrl) {
        if (typeof record.image_url === 'string') record.image_url = publicUrl;
        else record.image_url.url = publicUrl;
        onUpload(publicUrl);
      }
    }
  }

  if (record.type === 'image' && record.source?.type === 'base64' && typeof record.source.data === 'string') {
    const publicUrl = await uploadDataImage(`data:${record.source.media_type};base64,${record.source.data}`);
    if (publicUrl) {
      record.source = { type: 'url', url: publicUrl };
      onUpload(publicUrl);
    }
  }

  if (record.inlineData?.mimeType && typeof record.inlineData.data === 'string') {
    const publicUrl = await uploadDataImage(`data:${record.inlineData.mimeType};base64,${record.inlineData.data}`);
    if (publicUrl) {
      record.fileData = { mimeType: record.inlineData.mimeType, fileUri: publicUrl };
      delete record.inlineData;
      onUpload(publicUrl);
    }
  }

  await Promise.all(Object.values(record).map(item => replaceInlineImages(item, onUpload)));
  return value;
}

/** Local model-request bridge that makes every inline image publicly readable
 * before forwarding the request to the configured provider. */
export async function listenProviderProxy(config: OnlineModelConfig, onUpload: (url: string) => void) {
  const prefix = `/${randomBytes(18).toString('hex')}/v1`;
  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith(`${prefix}/`)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found' } }));
      return;
    }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES) throw new Error('模型请求内容过大。');
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      await replaceInlineImages(body, onUpload);
      const upstream = new URL(config.baseUrl.replace(/\/$/, '') + req.url.slice(prefix.length));
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (!value || ['host', 'content-length', 'connection', 'transfer-encoding', 'accept-encoding'].includes(key)) continue;
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      const response = await fetch(upstream, {
        method: req.method,
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(260000),
      });
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key)) responseHeaders[key] = value;
      });
      res.writeHead(response.status, responseHeaders);
      if (response.body) Readable.fromWeb(response.body as any).pipe(res);
      else res.end();
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : '模型请求转发失败。' } }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}${prefix}` };
}

