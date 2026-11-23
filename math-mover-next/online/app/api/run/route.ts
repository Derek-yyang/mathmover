import { upgradeWebSocketCompat } from '../../../server/vercel-websocket';
import { CanvasChannel, type Socket } from '../../../server/channel';
import { runOnline, probeOnlineRuntime, type RunInput } from '../../../server/run';
import { publicConfig } from '../../../server/config';
import { redactAgentError } from '@/lib/agent-diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return Response.json({ ...publicConfig(), transport: 'websocket', persistence: 'page-memory' });
  const origin = req.headers.get('origin');
  let sameOrigin = false;
  try { sameOrigin = Boolean(origin && new URL(origin).host === new URL(req.url).host); } catch { /* Invalid origins are rejected. */ }
  if (!sameOrigin) return new Response('只接受工作台同源请求。', { status: 403 });
  return upgradeWebSocketCompat(ws => {
    const channel = new CanvasChannel(ws as unknown as Socket);
    const controller = new AbortController();
    let started = false;
    const idle = setTimeout(() => ws.close(1000, 'idle'), 30000);
    ws.on('close', () => { clearTimeout(idle); controller.abort(); channel.dispose(); });
    ws.on('error', () => { controller.abort(); channel.dispose(); });
    ws.on('message', data => {
      let message: RunInput & { type?: string; id?: string; payload?: unknown; error?: string };
      try { message = JSON.parse(String(data)); } catch { ws.close(1008, 'invalid JSON'); return; }
      if (message.type === 'canvas-result') { channel.receive(message); return; }
      if (message.type === 'cancel') { controller.abort(); return; }
      if (started) { ws.close(1008, 'one run per connection'); return; }
      started = true; clearTimeout(idle);
      const task = message.type === 'probe'
        ? Promise.all([channel.call('ping'), probeOnlineRuntime()]).then(([result, runtime]) => channel.send({ type: 'probe-result', ok: result === true, ...runtime }))
        : message.type === 'start' ? runOnline(channel, message, controller.signal)
          : Promise.reject(new Error('未知请求。'));
      void task.catch(error => {
        if (!controller.signal.aborted) channel.send({ type: 'event', event: { kind: 'error', message: redactAgentError(error instanceof Error ? error.message : '生成服务异常。') } });
      }).finally(() => { channel.send({ type: 'finished' }); ws.close(1000, 'finished'); });
    });
    channel.send({ type: 'ready' });
  }, { maxPayload: 32 * 1024 * 1024 });
}
