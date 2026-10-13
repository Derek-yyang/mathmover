/**
 * 连接测试 —— 设置页每张卡片的「测试」按钮。
 *
 * 语义：回答老师课前唯一真正关心的问题「它现在跑得通吗」，三态收口：
 *   ready          就绪（可跑）
 *   not-logged-in  起得来但没登录/密钥未授权
 *   broken         起不来 / 端点不可达
 *   unconfigured   BYOK 还没填端点与模型
 *
 * CLI 侧复用 detectRuntimes 的探测（版本门 + 登录预检），不发任何模型请求；
 * BYOK 侧探 `${baseUrl}/models`（多数 OpenAI 兼容端点都有；404/405 视为可达）。
 */

import { RUNTIMES, detectRuntimes } from '@mathmover/agent-runtime';
import { dataDirectory } from '../../../../../packages/daemon/src/data-directory.ts';
import { loadByokConfig, isByokRunnable, maskByokConfig } from '@/lib/byok-store';

type TestResult = { ok: boolean; status: 'ready' | 'not-logged-in' | 'broken' | 'unconfigured'; message: string; version?: string | null };

async function testByok(): Promise<TestResult> {
  const config = loadByokConfig(dataDirectory());
  if (!isByokRunnable(config)) {
    return { ok: false, status: 'unconfigured', message: '未配置 API 端点与模型，请先填好并保存。' };
  }
  const base = config.baseUrl.trim().replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/models`, {
      headers: { ...(config.apiKey.trim() ? { authorization: `Bearer ${config.apiKey.trim()}` } : {}) },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) return { ok: true, status: 'ready', message: `端点可达${maskByokConfig(config).apiKeyConfigured ? '，密钥已授权' : ''}。` };
    if (res.status === 401 || res.status === 403) return { ok: false, status: 'not-logged-in', message: '端点可达，但密钥未授权（请检查 API 密钥）。' };
    if (res.status === 404 || res.status === 405) return { ok: true, status: 'ready', message: '端点可达（该端点未开放 /models，按可达计）。' };
    return { ok: false, status: 'broken', message: `端点返回 ${res.status}。` };
  } catch (e) {
    return { ok: false, status: 'broken', message: `无法连接端点：${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ error: '只接受工作台同源请求' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { runtimeId?: string };
  const id = (body.runtimeId ?? '').trim();
  if (!id) return Response.json({ error: '缺少 runtimeId' }, { status: 400 });

  if (id === 'byok') return Response.json(await testByok());

  const def = RUNTIMES.find((r) => r.id === id);
  if (!def) return Response.json({ error: `不认识的 agent：${id}` }, { status: 400 });

  const [detected] = await detectRuntimes([def]);
  if (!detected.usable) {
    return Response.json({
      ok: false,
      status: 'broken',
      message: detected.versionWarning ?? '未检测到可用的命令行程序（可能未安装或版本不可用）。',
      version: detected.version,
    } satisfies TestResult);
  }
  if (detected.authStatus === 'missing') {
    return Response.json({
      ok: false,
      status: 'not-logged-in',
      message: detected.authMessage ?? '命令行程序可运行，但尚未登录。',
      version: detected.version,
    } satisfies TestResult);
  }
  return Response.json({
    ok: true,
    status: 'ready',
    message: detected.authMessage && detected.authStatus === 'ok' ? `就绪 · ${detected.authMessage}` : '就绪（登录状态未知，不影响本地运行检测）。',
    version: detected.version,
  } satisfies TestResult);
}
