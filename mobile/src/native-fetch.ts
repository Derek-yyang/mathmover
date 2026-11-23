import { Capacitor } from '@capacitor/core';
import { StreamHttp } from 'capacitor-stream-http';

type PendingStream = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  resolveResponse: (head: { status: number; headers: Record<string, string> }) => void;
  rejectResponse: (error: Error) => void;
};

const encoder = new TextEncoder();
const pending = new Map<string, PendingStream>();
let listenersReady: Promise<void> | null = null;

function ensureListeners() {
  if (listenersReady) return listenersReady;
  listenersReady = Promise.all([
    StreamHttp.addListener('response', event => {
      pending.get(event.id)?.resolveResponse({
        status: event.status,
        headers: event.headers ?? {},
      });
    }),
    StreamHttp.addListener('chunk', event => {
      const entry = pending.get(event.id);
      if (entry && event.chunk) entry.controller.enqueue(encoder.encode(event.chunk));
    }),
    StreamHttp.addListener('end', event => {
      const entry = pending.get(event.id);
      if (!entry) return;
      entry.controller.close();
      entry.resolveResponse({ status: 200, headers: {} });
      pending.delete(event.id);
    }),
    StreamHttp.addListener('error', event => {
      const entry = pending.get(event.id);
      if (!entry) return;
      const error = new Error(event.error ?? 'native stream error');
      entry.controller.error(error);
      entry.rejectResponse(error);
      pending.delete(event.id);
    }),
  ]).then(() => undefined);
  return listenersReady;
}

/**
 * 在 Capacitor 原生容器里用 native HTTP 发请求，绕开 WebView 的 CORS，
 * 并把原生 chunk 事件包装成 ReadableStream 交给 AI SDK 解析 SSE。
 * 浏览器环境下退回标准 fetch。
 */
export async function nativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!Capacitor.isNativePlatform()) return fetch(input, init);

  await ensureListeners();
  const request = input instanceof Request ? input : new Request(input, init);
  const headers = Object.fromEntries(request.headers.entries());
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();

  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let resolveResponse!: PendingStream['resolveResponse'];
  let rejectResponse!: PendingStream['rejectResponse'];
  const head = new Promise<{ status: number; headers: Record<string, string> }>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });

  let streamId: string | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel() { if (streamId) void StreamHttp.cancelStream({ id: streamId }); },
  });

  try {
    const started = await StreamHttp.startStream({
      url: request.url,
      method: request.method,
      headers,
      body,
    });
    streamId = started.id;
    pending.set(streamId, { controller, resolveResponse, rejectResponse });

    const responseHead = await head;
    return new Response(stream, {
      status: responseHead.status,
      headers: {
        'content-type': 'text/event-stream',
        ...responseHead.headers,
      },
    });
  } catch (error) {
    pending.delete(streamId ?? '');
    controller.error(error);
    throw error;
  }
}
