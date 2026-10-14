export type GgbConnectionStatus = 'loading' | 'connecting' | 'connected' | 'disconnected';

/** Own one connection attempt at a time, including its binding request and retry timers. */
export function connectGgbDaemon(options: {
  windowId?: string;
  wsUrl: string;
  onStatus?: (status: GgbConnectionStatus) => void;
  onMessage: (event: MessageEvent, socket: WebSocket) => void | Promise<void>;
}) {
  let socket: WebSocket | null = null;
  let controller: AbortController | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let attempt = 0;
  let status: GgbConnectionStatus | undefined;
  const publish = (next: GgbConnectionStatus) => {
    if (disposed || status === next) return;
    status = next;
    options.onStatus?.(next);
  };
  const retire = () => {
    clearTimeout(retryTimer);
    clearTimeout(deadline);
    controller?.abort();
    controller = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
      socket = null;
    }
  };
  const connect = async (manual = false) => {
    if (disposed) return;
    const current = ++attempt;
    retire();
    // Keep the disconnected indicator stable while retrying in the background.
    if (status !== 'disconnected' || manual) publish('connecting');
    const failed = () => {
      if (disposed || current !== attempt) return;
      ++attempt;
      retire();
      publish('disconnected');
      retryTimer = setTimeout(() => void connect(), 2000);
    };
    // A stalled HTTP binding or WebSocket handshake must not stay "connecting" forever.
    deadline = setTimeout(failed, 8000);
    controller = new AbortController();
    try {
      let bindingToken: string | undefined;
      if (options.windowId) {
        const response = await fetch('/api/coursewares/windows', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ windowId: options.windowId }), signal: controller.signal,
        });
        if (disposed || current !== attempt) return;
        if (!response.ok) throw new Error('窗口绑定失败');
        const binding = await response.json();
        if (disposed || current !== attempt) return;
        if (typeof binding.bindingToken !== 'string' || !binding.bindingToken) throw new Error('窗口绑定票据缺失');
        bindingToken = binding.bindingToken;
      }
      const next = new WebSocket(options.wsUrl);
      socket = next;
      next.onopen = () => {
        if (disposed || current !== attempt) return;
        try {
          next.send(JSON.stringify({ type: 'hello', version: 1, windowId: options.windowId, bindingToken }));
          clearTimeout(deadline);
          publish('connected');
        } catch { failed(); }
      };
      next.onmessage = event => {
        if (!disposed && current === attempt) void options.onMessage(event, next);
      };
      next.onclose = failed;
      next.onerror = failed;
    } catch { failed(); }
  };
  void connect();
  return {
    reconnect: () => void connect(true),
    close: () => {
      disposed = true;
      ++attempt;
      retire();
    },
  };
}
