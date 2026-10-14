import type http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { CoursewareStore } from './courseware-store.ts';
import { CoursewareError } from '@mathmover/ggb-core';
import type { GgbBridgeClient } from './bridge-client.ts';

export interface LibraryServices { store: CoursewareStore; token: string; bridge: GgbBridgeClient }
export function authorized(req: http.IncomingMessage, token: string): boolean {
  const supplied = String(req.headers['x-mathmover-token'] ?? '');
  const actual = Buffer.from(supplied); const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 64 * 1024 * 1024) throw new CoursewareError(413, '课件请求过大，请减少单次图片数量');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new CoursewareError(400, '请求不是合法 JSON'); }
}
export async function libraryRequest(req: http.IncomingMessage, res: http.ServerResponse, url: URL, services: LibraryServices): Promise<boolean> {
  if (!url.pathname.startsWith('/api/coursewares')) return false;
  const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (!authorized(req, services.token)) { send(403, { error: '本地课件库访问校验失败' }); return true; }
  const { store, bridge } = services;
  const parts = url.pathname.split('/').filter(Boolean).slice(2);
  const method = req.method;
  try {
    if (!parts.length && method === 'GET') {
      if (url.searchParams.has('trash')) throw new CoursewareError(400, '回收站接口已移除，请使用归档');
      const archived = url.searchParams.get('archived');
      send(200, { records: archived === 'all' ? [...store.list(), ...store.list(true)] : store.list(archived === '1'), dataDirectory: store.root,
        capabilities: { archive: true, permanentDelete: true } });
    }
    else if (!parts.length && method === 'POST') send(200, store.save(await readJson(req)));
    else if (parts[0] === 'delete' && method === 'POST') { const body = await readJson(req); if (!Array.isArray(body.ids)) throw new CoursewareError(400, '缺少课件 ID'); store.remove(body.ids); send(200, { ok: true }); }
    else if (parts[0] === 'backup' && method === 'POST') send(200, { name: await store.createBackup() });
    else if (parts[0] === 'windows' && parts.length === 1 && method === 'POST') { const body = await readJson(req); send(200, { bindingToken: bridge.issueBinding(body.windowId) }); }
    else if (parts[0] === 'assets' && parts.length === 2 && method === 'GET') {
      const asset = store.asset(parts[1]); res.writeHead(200, { 'content-type': asset.mime, 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' }); res.end(asset.data);
    } else if (parts.length === 1 && method === 'GET') send(200, store.get(parts[0]));
    else if (parts[1] === 'rename' && parts.length === 2 && method === 'POST') { const body = await readJson(req); send(200, store.rename(parts[0], body.title, body.expectedRevision)); }
    else if ((parts[1] === 'archive' || parts[1] === 'unarchive') && parts.length === 2 && method === 'POST') {
      const body = await readJson(req); send(200, store.setArchived(parts[0], parts[1] === 'archive', body.expectedRevision));
    }
    else if (parts[1] === 'versions' && parts.length === 2 && method === 'GET') send(200, { versions: store.versions(parts[0]) });
    else if (parts[1] === 'versions' && parts.length === 3 && method === 'GET' && /^\d+$/.test(parts[2])) send(200, store.get(parts[0], Number(parts[2])));
    else send(404, { error: '未知课件接口' });
  } catch (e) { send(e instanceof CoursewareError ? e.status : 500, { error: e instanceof CoursewareError ? e.message : '本地课件读写失败，原数据已保留，请检查磁盘空间、目录权限或服务日志' }); console.error('[courseware-library]', e); }
  return true;
}
