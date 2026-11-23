import http from 'node:http';
import { randomBytes } from 'node:crypto';
import type { ToolsLike } from '../../../packages/daemon/src/tools-http.ts';

/** Private loopback tool adapter, scoped to one run. No courseware database. */
export async function listenTools(tools: ToolsLike) {
  const prefix = `/${randomBytes(24).toString('hex')}`;
  const server = http.createServer(async (req, res) => {
    const reply = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.origin || !req.url?.startsWith(`${prefix}/api/`)) { reply(403, { error: 'Forbidden' }); return; }
    try {
      const url = new URL(req.url.slice(prefix.length), 'http://localhost');
      let body: Record<string, unknown> = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) { reply(413, { error: 'Tool request too large' }); return; } chunks.push(chunk); }
        const content = Buffer.concat(chunks).toString();
        body = content ? JSON.parse(content) : {};
        if (!body || typeof body !== 'object') throw new Error('Invalid tool request');
      }
      const commands = body.commands;
      if (commands !== undefined && (!Array.isArray(commands) || commands.some(c => typeof c !== 'string'))) throw new Error('Invalid commands');
      const opts = { png: body.png !== false, incremental: body.incremental === true };
      if (req.method === 'GET' && url.pathname === '/api/state') reply(200, await tools.getState({ png: url.searchParams.get('png') !== '0' }));
      else if (req.method === 'POST' && url.pathname === '/api/apply') reply(200, await tools.apply(commands as string[] | undefined, opts));
      else if (req.method === 'GET' && url.pathname === '/api/construction') reply(200, await tools.readConstruction());
      else if (req.method === 'PUT' && url.pathname === '/api/construction' && Array.isArray(commands)) reply(200, await tools.writeConstruction(commands));
      else if (req.method === 'POST' && url.pathname === '/api/reset') { await tools.reset(); reply(200, { ok: true }); }
      else reply(404, { error: 'Unknown tool endpoint' });
    } catch (error) { reply(400, { error: error instanceof Error ? error.message : 'Tool failed' }); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}${prefix}` };
}
