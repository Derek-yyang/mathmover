/**
 * 内置 Agent（OpenCode）的端点配置接口 —— BYOK：端点与密钥由用户自带，
 * 运行时随应用内置（2026-10-18 起那是个自带的 OpenCode，不再是自研循环）。
 *
 * GET：掩码视图（apiFormat / baseUrl / model / apiKeyConfigured / apiKeyTail）——
 * **完整 key 永不回传**（对齐 OpenDesign 的 apiKeyConfigured + 尾 4 位模式）。
 * POST：保存。key 传空 = 保留原 key（改端点/模型不必重填）。
 * 配置落在应用数据目录（byok.json），不进课件备份（备份只打包 DB 及引用资源）。
 */

import { dataDirectory } from '../../../../packages/daemon/src/data-directory.ts';
import { loadByokConfig, maskByokConfig, saveByokConfig, type ByokConfig } from '@/lib/byok-store';
import { invalidateDetectionCache } from '@/lib/server/detection-cache';
import { isSameLocalOrigin } from '@/lib/server/same-origin';
import { isApiFormat } from '../../../../packages/agent-runtime/src/api-format.ts';

export async function GET(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  if (!isSameLocalOrigin(req.url, origin)) return Response.json({ error: '只接受工作台同源请求' }, { status: 403 });
  return Response.json(maskByokConfig(loadByokConfig(dataDirectory())));
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  if (!isSameLocalOrigin(req.url, origin)) return Response.json({ error: '只接受工作台同源请求' }, { status: 403 });
  const raw: unknown = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return Response.json({ error: '配置必须是 JSON 对象' }, { status: 400 });
  }
  const body = raw as Omit<Partial<ByokConfig>, 'apiKey'> & { apiKey?: string | null };
  if (body.apiFormat !== undefined && !isApiFormat(body.apiFormat)) {
    return Response.json({ error: '不支持的 API 接口格式' }, { status: 400 });
  }
  const view = saveByokConfig(dataDirectory(), {
    apiFormat: body.apiFormat,
    baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
    // null = 清除；空串/不传 = 保留原 key（语义见 byok-store.ts）
    apiKey: body.apiKey === null ? null : typeof body.apiKey === 'string' ? body.apiKey : undefined,
    model: typeof body.model === 'string' ? body.model : undefined,
    reasoningLevels: typeof body.reasoningLevels === 'string' ? body.reasoningLevels : undefined,
  });
  // 配置一变，运行时清单就旧了（模型清单、档位都挂在它上面）——作废缓存，
  // 否则用户保存完 60 秒内重开页面还是旧值。
  invalidateDetectionCache();
  return Response.json(view);
}
