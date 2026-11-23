import { WebSocketServer, type WebSocket } from 'ws';

type UpgradeContext = {
  upgradeWebSocket?: () => { req: unknown; socket: unknown; head: Buffer };
};
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

function getContext(): UpgradeContext {
  return (globalThis as Record<symbol, { get?: () => UpgradeContext } | undefined>)[REQUEST_CONTEXT]?.get?.() ?? {};
}

/** Same platform handshake as @vercel/functions, with ws loaded statically. */
export async function upgradeWebSocketCompat(
  handler: (socket: WebSocket) => void | Promise<void>,
  options: { maxPayload?: number } = {},
) {
  const upgrade = getContext().upgradeWebSocket;
  if (typeof upgrade !== 'function') {
    throw new Error('The current runtime does not support WebSocket upgrades.');
  }
  const { req, socket, head } = upgrade();
  const server = new WebSocketServer({ noServer: true, maxPayload: options.maxPayload });
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const cleanup = () => {
      (socket as any).removeListener?.('error', onError);
      (socket as any).removeListener?.('close', onClose);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error('Socket closed before WebSocket upgrade completed.')); };
    (socket as any).once?.('error', onError);
    (socket as any).once?.('close', onClose);
    try {
      server.handleUpgrade(req as any, socket as any, head, (value) => { cleanup(); resolve(value); });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
  try {
    await handler(ws);
  } catch {
    ws.close(1011, 'WebSocket handler failed');
    throw new Error('WebSocket handler failed.');
  }
  return new Response(null, { status: 204 });
}
