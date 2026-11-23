import type { GeoGebraApi } from '../../math-mover-next/components/dashboard/types';
import { createCoursewareHTML } from '../../math-mover-next/lib/ggb-html-export';
import { getCoursewarePNG } from '../../math-mover-next/lib/ggb-png-export';

export type ExportFormat = 'ggb' | 'html' | 'png';

export async function createExport(api: GeoGebraApi, format: ExportFormat, title: string, root: HTMLElement | null) {
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'MathMover';
  const filename = `${name}.${format}`;
  let blob: Blob;
  if (format === 'png') {
    const url = getCoursewarePNG(api, () => root?.querySelector<HTMLCanvasElement>('.GeoGebraFrame canvas')?.toDataURL('image/png') ?? null);
    blob = new Blob([Uint8Array.from(atob(url.split(',')[1]), char => char.charCodeAt(0))], { type: 'image/png' });
  } else {
    const base64 = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('获取画板快照超时，请重试。')), 15000);
      try { api.getBase64(value => { clearTimeout(timer); value ? resolve(value) : reject(new Error('画板快照为空，请重试。')); }); }
      catch (error) { clearTimeout(timer); reject(error); }
    });
    if (format === 'html') {
      let view: unknown;
      try { view = api.getViewProperties?.(1); } catch { /* Snapshot still works with older runtimes. */ }
      blob = new Blob([createCoursewareHTML(base64, title, view)], { type: 'text/html' });
    } else {
      blob = new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'application/vnd.geogebra.file' });
    }
  }
  return { filename, blob };
}

export async function downloadExport({ filename, blob }: { filename: string; blob: Blob }, target: 'browser' | 'host'): Promise<string> {
  if (target === 'browser') {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    try { link.click(); }
    finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    return '已交给浏览器下载';
  }

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('读取导出文件失败，请重试。'));
    reader.readAsDataURL(blob);
  });
  // The App wrapper crosses the host's sandbox through ui/download-file.
  // Blob URLs belong to this frame and cannot be downloaded by the host.
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.type !== 'mathmover:export-result' || event.data.requestId !== requestId) return;
      cleanup();
      if (event.data.error) reject(new Error(String(event.data.error)));
      else resolve('已导出');
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('导出等待超时，请确认宿主中的保存窗口，或在浏览器中打开画板后导出。')); }, 180000);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'mathmover:export', requestId, resource: { uri: `file:///${encodeURIComponent(filename)}`, mimeType: blob.type, blob: base64 } }, '*');
  });
}
