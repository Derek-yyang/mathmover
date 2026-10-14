'use client';
import type { AgentChatMessage, GeoGebraApi } from '@/components/dashboard/types';
import { readViewBounds } from './ggb-view-transition';
import { readGgbGraphics } from './ggb-graphics-state';
// 课件库契约是跨进程共享的，唯一真源在 ggb-core。只走 /types 子路径。
import { CoursewareError, type CoursewareSummary } from '@mathmover/ggb-core/types';

// CoursewareError 是类（值），必须用 export 而非 export type ——
// useCoursewareLibrary 要拿它做 instanceof。export type 会把类擦成纯类型。
export type { CoursewareSummary };
export { CoursewareError };

/** 带正文的完整课件记录。`messages` 是前端领域类型，故只在前端声明。 */
export interface CoursewareRecord extends CoursewareSummary {
  commands: string[]; messages: AgentChatMessage[]; ggbBase64?: string;
  runtimeId?: string; sessionId?: string;
  view?: { showAxes: boolean; showGrid: boolean; bounds?: [number, number, number, number] };
}
export async function libraryRequest<T>(path = '', body?: unknown): Promise<T> {
  const res = await fetch(`/api/coursewares${path}`, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CoursewareError(res.status, data.error || `本地课件库返回 ${res.status}`);
  return data;
}
export const historyChanged = (detail?: unknown) => window.dispatchEvent(new CustomEvent('mathmover_coursewares_changed', { detail }));
export const getCourseware = (id: string) => libraryRequest<CoursewareRecord>(`/${encodeURIComponent(id)}`);
export async function renameCourseware(id: string, title: string, expectedRevision: number) {
  const summary = await libraryRequest<CoursewareSummary>(`/${encodeURIComponent(id)}/rename`, { title, expectedRevision }); historyChanged({ kind: 'rename', summary });
}
export async function deleteCoursewares(ids: string[]) {
  const service = await libraryRequest<{ capabilities?: { permanentDelete?: boolean } }>();
  if (!service.capabilities?.permanentDelete) throw new CoursewareError(503, '课件库服务版本过旧，请重启 daemon 后使用永久删除');
  await libraryRequest('/delete', { ids }); historyChanged({ kind: 'delete', ids });
}
export async function archiveCourseware(id: string, archived: boolean, expectedRevision: number) {
  const summary = await libraryRequest<CoursewareSummary>(`/${encodeURIComponent(id)}/${archived ? 'archive' : 'unarchive'}`, { expectedRevision });
  historyChanged({ kind: archived ? 'archive' : 'unarchive', summary });
}

const imageCache = new WeakMap<File, Promise<string>>();
export async function persistableMessages(messages: AgentChatMessage[]): Promise<AgentChatMessage[]> {
  return Promise.all(messages.map(async message => ({ ...message, attachments: message.attachments ? await Promise.all(message.attachments.map(async a => {
    let url = a.url;
    if (a.file) {
      let cached = imageCache.get(a.file);
      if (!cached) { const file = a.file; cached = new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('题目图片读取失败，尚未保存')); reader.readAsDataURL(file);
      }); imageCache.set(a.file, cached); }
      url = await cached;
    }
    return { id: a.id, name: a.name, contentType: a.contentType, url };
  })) : undefined })));
}
export function captureGgb(api: GeoGebraApi): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('画板快照生成超时，尚未保存')), 15000);
    try { api.getBase64(base64 => { clearTimeout(timeout); if (!base64) reject(new Error('画板没有返回快照')); else resolve(base64); }); }
    catch (error) { clearTimeout(timeout); reject(error); }
  });
}
export function currentView(api: GeoGebraApi, showAxes: boolean, showGrid: boolean): CoursewareRecord['view'] {
  const bounds = readViewBounds(api.getViewProperties?.(1));
  const actual = readGgbGraphics(api);
  return { showAxes: actual ? actual.axes === 'all' : showAxes, showGrid: actual?.showGrid ?? showGrid,
    bounds: bounds ? [bounds.xMin, bounds.xMax, bounds.yMin, bounds.yMax] : undefined };
}
export function interruptedMessages(messages: AgentChatMessage[]): AgentChatMessage[] {
  return messages.map(message => message.meta?.status === 'generating' || message.meta?.execution?.status === 'running'
    ? { ...message, meta: { ...message.meta, status: 'error', errorMessage: '上次任务已中断，已恢复最后保存的内容；不会自动重跑 Agent。',
      execution: message.meta.execution ? { ...message.meta.execution, status: 'unconfirmed', endedAt: Date.now(), steps: message.meta.execution.steps.map(s => s.status === 'running' ? { ...s, status: 'unconfirmed', endedAt: Date.now() } : s) } : undefined } }
    : message);
}
