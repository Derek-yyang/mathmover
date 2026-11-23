import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Download, Grid2X2, LoaderCircle, Maximize2, Minimize2, PanelLeft, RotateCcw, Settings2 } from 'lucide-react';
import { CoursewareLibrary } from './CoursewareLibrary';
import { createExport, downloadExport, type ExportFormat } from './export';
import { checkExportSupport } from './export-bridge';
import GeoGebraBoard from '../../math-mover-next/components/GeoGebraBoard';
import { useGgbSession } from '../../math-mover-next/hooks/useGgbSession';
import { useGgbGraphics } from '../../math-mover-next/hooks/useGgbGraphics';
import { attachGgbBridge } from '../../math-mover-next/lib/ggb-bridge';
import type { GgbConnectionStatus } from '../../math-mover-next/lib/ggb-connection';
import './canvas.css';

type CanvasInfo = { id: string; title: string; workfile: string; commands: string[]; snapshot: string | null; managementToken: string };
const id = location.pathname.split('/').pop() ?? '';
const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
const endpoint = `/api/sessions/${encodeURIComponent(id)}`;
const headers = { Authorization: `Bearer ${token}` };

function App() {
  const [info, setInfo] = useState<CanvasInfo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { headers, signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '无法打开画板');
      setInfo(data);
      document.title = `${data.title} · MathMover`;
    }).catch(error => { if (!controller.signal.aborted) setError(String(error.message ?? error)); });
    return () => controller.abort();
  }, []);
  if (error) return <main className="launch-message" role="alert"><span className="brand-mark">M</span><h1>暂时无法打开画板</h1><p>{error}</p><p>请回到 Agent，通过 mathmover_open_canvas 重新打开当前课件。</p><button onClick={() => location.reload()}>重新连接</button></main>;
  if (!info) return <main className="launch-message" role="status"><LoaderCircle className="spinner" /><p>正在打开 MathMover 画板…</p></main>;
  return <Canvas info={info} />;
}

function Canvas({ info }: { info: CanvasInfo }) {
  const boardRef = useRef<HTMLDivElement>(null);
  const ledgerRef = useRef(info.commands);
  const bridgeRef = useRef<ReturnType<typeof attachGgbBridge> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saving = useRef<Promise<boolean> | null>(null);
  const saveAgain = useRef(false);
  const [status, setStatus] = useState<GgbConnectionStatus>('loading');
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    const update = (event: Event) => setMoved(Boolean((event as CustomEvent).detail.moved));
    window.addEventListener('mathmover:connection', update);
    return () => window.removeEventListener('mathmover:connection', update);
  }, []);
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportLabel, setExportLabel] = useState('导出');
  const [exportStatus, setExportStatus] = useState('');
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const exportBusy = useRef(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  useEffect(() => {
    const syncFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);
  const [title, setTitle] = useState(info.title);
  useEffect(() => {
    document.title = `${title} · MathMover`;
    window.parent.postMessage({ type: 'mathmover:active-canvas', session_id: info.id, title, workfile: info.workfile }, '*');
  }, [title, info.id, info.workfile]);
  const [commands, setCommands] = useState(info.commands.length);
  const session = useGgbSession({ containerRef: boardRef, onError: setNotice });
  const api = session.ggbApplet;
  const graphics = useGgbGraphics(api);
  const executor = useRef(session.executeCommands);
  executor.current = session.executeCommands;
  const restoreLedger = useRef(session.restoreCommandLedger);
  restoreLedger.current = session.restoreCommandLedger;

  const save = useCallback(() => {
    if (!api || moved) return Promise.resolve(true);
    if (saving.current) { saveAgain.current = true; return saving.current; }
    clearTimeout(saveTimer.current);
    const commands = [...ledgerRef.current];
    const operation = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('获取画板快照超时')), 10000);
      try { api.getBase64((value: string) => { clearTimeout(timeout); resolve(value); }); }
      catch (error) { clearTimeout(timeout); reject(error); }
    }).then(async base64 => {
      const response = await fetch(`${endpoint}/snapshot`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ base64, commands }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '保存失败');
      return true;
    }).catch(error => { setNotice(String(error.message ?? error)); return false; }).finally(() => {
      saving.current = null;
      if (saveAgain.current) {
        saveAgain.current = false;
        void saveLatest.current();
      }
    });
    saving.current = operation;
    return operation;
  }, [api, moved]);
  const saveLatest = useRef(save);
  saveLatest.current = save;
  const beforeLeave = async () => {
    if (!await save()) return false;
    // A save already in progress can schedule one more snapshot; await it
    // before unloading the old board, including after dragging a point.
    while (saving.current) {
      if (!await saving.current) return false;
    }
    clearTimeout(saveTimer.current);
    return true;
  };

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    const scheduleSave = () => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void saveLatest.current(), 800);
    };
    const restore = async () => {
      if (info.snapshot) {
        const snapshot = info.snapshot;
        if (!api.setBase64) throw new Error('当前画板不支持快照恢复');
        const restoreSnapshot = api.setBase64.bind(api);
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('画板恢复超时，请重试连接')), 20000);
          try { restoreSnapshot(snapshot, () => { clearTimeout(timeout); resolve(); }); }
          catch (error) { clearTimeout(timeout); reject(error); }
        });
      } else if (info.commands.length) {
        await executor.current(info.commands);
      }
      if (disposed) return;
      restoreLedger.current(info.commands);
      bridgeRef.current = attachGgbBridge(api, {
        getLedger: () => ledgerRef.current,
        canvasRoot: boardRef.current ?? undefined,
        wsUrl: `${location.origin.replace('http:', 'ws:')}/ws/${id}?token=${token}`,
        onConnectionChange: setStatus,
        onLedgerChange: ledger => {
          ledgerRef.current = [...ledger];
          restoreLedger.current(ledger);
          setCommands(ledger.length);
          scheduleSave();
        },
        applyCommands: async ({ commands, incremental, ledger }) => {
          setNotice('');
          const result = await executor.current(commands, { incremental });
          if (!result) throw new Error('画板执行被中断，请读取状态后重试');
          ledgerRef.current = ledger ?? commands;
          restoreLedger.current(ledgerRef.current);
          return { applied: commands, failedFirstPass: [] };
        },
      });
      api.registerUpdateListener?.(scheduleSave);
      api.registerClientListener?.(scheduleSave);
    };
    void restore().catch(error => { setNotice(String(error.message ?? error)); setStatus('disconnected'); });
    return () => {
      disposed = true;
      clearTimeout(saveTimer.current);
      api.unregisterUpdateListener?.(scheduleSave);
      api.unregisterClientListener?.(scheduleSave);
      bridgeRef.current?.();
      bridgeRef.current = null;
    };
  }, [api, info]);

  const ready = status === 'connected';
  const exportFile = async (format: ExportFormat) => {
    if (!api || exportBusy.current) return;
    exportBusy.current = true;
    if (exportMenu.current) exportMenu.current.open = false;
    setExporting(true);
    setExportLabel('准备导出…');
    setExportStatus('');
    setNotice('');
    try {
      const target = await checkExportSupport();
      setExportLabel(format === 'png' ? '生成图片…' : '生成文件…');
      // Paint the generation state before calling GeoGebra's synchronous PNG API.
      await new Promise(resolve => setTimeout(resolve, 0));
      const file = await createExport(api, format, title, boardRef.current);
      setExportLabel(target === 'host' ? '等待保存…' : '开始下载…');
      setExportStatus(await downloadExport(file, target));
    }
    catch (error) { setNotice(String((error as Error).message ?? error)); }
    finally { exportBusy.current = false; setExporting(false); }
  };
  return <main className="workspace" data-connected={ready}>
    <header className="toolbar">
      <button className="library-trigger" aria-controls="courseware-library" aria-expanded={libraryOpen} title={libraryOpen ? '收起课件栏' : '展开课件栏'} onClick={() => setLibraryOpen(open => !open)}><PanelLeft size={18} aria-hidden="true" />课件</button>
      <div className="identity"><span className="brand-mark">M</span><strong>MathMover</strong><span className="edition">MCP 版</span></div>
      <div className="document-title"><h1 title={title}>{title}</h1><span className={`connection ${ready ? 'online' : ''}`} role="status"><i />{ready ? '已连接' : status === 'disconnected' ? '连接已断开' : '正在连接…'}</span></div>
      <div className="actions" aria-label="画板工具">
        <button className={graphics.axes === 'all' ? 'selected' : ''} disabled={!api} aria-label="切换坐标轴" aria-pressed={graphics.axes === 'all'} title="坐标轴" onClick={graphics.toggleAxes}>XY</button>
        <button className={graphics.showGrid ? 'selected' : ''} disabled={!api} aria-label="切换网格" aria-pressed={graphics.showGrid} title="网格" onClick={graphics.toggleGrid}><Grid2X2 size={17} /></button>
        <button disabled={!api} aria-label="画板设置" title="画板设置" aria-pressed={graphics.settingsOpen} onClick={graphics.toggleSettings}><Settings2 size={17} /></button>
        <button disabled={!api} aria-label="居中视图" title="居中视图" onClick={session.resetView}><RotateCcw size={17} /></button>
        <span className="separator" />
        <details className="export-menu" ref={exportMenu}><summary aria-label="导出课件" aria-busy={exporting} aria-disabled={exporting} onClick={event => { if (exporting) event.preventDefault(); }}>{exporting ? <LoaderCircle size={16} className="spinner" /> : <Download size={16} />}<span>{exporting ? exportLabel : '导出'}</span></summary><div>
          <button disabled={!api || exporting} onClick={() => void exportFile('ggb')}>GeoGebra 文件</button>
          <button disabled={!api || exporting} onClick={() => void exportFile('html')}>交互 HTML</button>
          <button disabled={!api || exporting} onClick={() => void exportFile('png')}>PNG 图片</button>
        </div></details>
        <button className="fullscreen-toggle" disabled={!api} aria-label={fullscreen ? '退出全屏' : '全屏演示'} title={fullscreen ? '退出全屏' : '全屏演示'} aria-pressed={fullscreen} onClick={() => { const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); void action.catch(error => setNotice(error.message)); }}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      </div>
    </header>
    <CoursewareLibrary open={libraryOpen} onClose={() => setLibraryOpen(false)} currentId={info.id} managementToken={info.managementToken} beforeLeave={beforeLeave} onRename={setTitle} />
    {notice && <div className="notice" role="alert"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}
    {exportStatus && <div className="notice export-success" role="status"><span>{exportStatus}</span><button onClick={() => setExportStatus('')} aria-label="关闭导出提示">×</button></div>}
    {status === 'disconnected' && <div className="notice" role="status">{moved ? '画板已在另一页面打开。请在新页面继续，或切回此处。' : '正在恢复画板连接，当前图形会保留。'}<button onClick={() => location.reload()}>{moved ? '在此继续' : '重新连接'}</button></div>}
    <div className="board" ref={boardRef}>
      <GeoGebraBoard onAppletReady={session.handleAppletReady} showResetIcon={false} />
      {commands === 0 && api && <div className="empty-hint"><p>在 Agent 中发送题目，图形会在这里逐步建立。</p></div>}
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
