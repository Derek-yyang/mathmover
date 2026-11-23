/** MCP-only connection policy. Web/Desktop retain their existing connector. */
export type GgbConnectionStatus = 'loading' | 'connecting' | 'connected' | 'disconnected';

export function connectGgbDaemon(options: {
  wsUrl: string;
  onStatus?: (status: GgbConnectionStatus) => void;
  onMessage: (event: MessageEvent, socket: WebSocket) => void | Promise<void>;
}) {
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let attempt = 0;
  const publish = (status: GgbConnectionStatus, moved = false) => {
    window.dispatchEvent(new CustomEvent('mathmover:connection', { detail: { moved } }));
    options.onStatus?.(status);
  };
  const retire = () => {
    clearTimeout(timer);
    clearTimeout(deadline);
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
      socket = null;
    }
  };
  const connect = () => {
    if (disposed) return;
    const current = ++attempt;
    retire();
    publish('connecting');
    const fail = (moved = false) => {
      if (disposed || current !== attempt) return;
      ++attempt;
      retire();
      publish('disconnected', moved);
      // Never compete with the newly opened view. Explicit reconnect can
      // reclaim ownership, while real transport failures still retry.
      if (!moved) timer = setTimeout(connect, 2000);
    };
    deadline = setTimeout(() => fail(), 8000);
    try {
      const next = new WebSocket(options.wsUrl);
      socket = next;
      next.onopen = () => {
        if (disposed || current !== attempt) return;
        clearTimeout(deadline);
        publish('connected');
      };
      next.onmessage = event => {
        if (!disposed && current === attempt) void options.onMessage(event, next);
      };
      next.onclose = event => fail(event.code === 4001);
      // Wait for close to retain its code (including the ownership transfer).
      next.onerror = () => {};
    } catch { fail(); }
  };
  connect();
  return {
    reconnect: connect,
    close: () => { disposed = true; ++attempt; retire(); },
  };
}
