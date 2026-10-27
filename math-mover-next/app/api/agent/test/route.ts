/**
 * 连接测试 —— 设置页每张卡片的「测试」按钮。
 *
 * CLI 保持非生成式预检；内置 Agent 使用已保存配置发出一次简短模型请求：
 *   ready          CLI 预检通过 / API 模型调用成功
 *   not-logged-in  起得来但没登录/密钥未授权
 *   broken         起不来 / 端点不可达
 *   unconfigured   内置位还没填端点与模型
 *   unverified     调用地址、格式或回复异常，无法验证
 *
 * CLI 侧复用 detectRuntimes 的探测（版本门 + 登录预检），不发任何模型请求；
 * 内置位不读取模型列表，不重试、不传课件或对话内容；不保证工具调用能力。
 */

import { RUNTIMES, detectRuntimes } from '@mathmover/agent-runtime';
import { dataDirectory } from '../../../../../packages/daemon/src/data-directory.ts';
import { loadByokConfig, isByokRunnable } from '@/lib/byok-store';
import { probeByokConfig } from '@/lib/byok-probe';
import { isSameLocalOrigin } from '@/lib/server/same-origin';

type TestResult = { ok: boolean; status: 'ready' | 'not-logged-in' | 'broken' | 'unconfigured' | 'unverified'; message: string; version?: string | null };

async function testByok(signal: AbortSignal): Promise<TestResult> {
  const config = loadByokConfig(dataDirectory());
  if (!isByokRunnable(config)) {
    return { ok: false, status: 'unconfigured', message: '未配置 API 端点与模型，请先填好并保存。' };
  }
  return probeByokConfig(config, fetch, { signal });
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  if (!isSameLocalOrigin(req.url, origin)) return Response.json({ error: '只接受工作台同源请求' }, { status: 403 });
  const body: unknown = await req.json().catch(() => null);
  const id = body && typeof body === 'object' && 'runtimeId' in body && typeof body.runtimeId === 'string' ? body.runtimeId.trim() : '';
  if (!id) return Response.json({ error: '缺少 runtimeId' }, { status: 400 });

  if (id === 'byok') return Response.json(await testByok(req.signal), { headers: { 'cache-control': 'no-store' } });

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
