import { useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Toaster, toast } from 'sonner';
import { runAgent, testProvider, type AgentConfig, type RunMode, type SpikeEvent } from './agent';
import { sharePng } from './export';
import { createGgbCanvas, type GgbCanvas } from './ggb-canvas';
import { nativeFetch } from './native-fetch';
import { loadApiKey, saveApiKey } from './lib/secure-key';
import {
  readProtocol,
  readWorks,
  upsertWork,
  updateWorkTitle,
  deleteWork as removeWorkFromStore,
  STORAGE_BASE,
  STORAGE_MODEL,
  STORAGE_PROTOCOL,
  type SettingsValue,
  type WorkItem,
} from './lib/store';
import { HomeScreen } from './components/screens/home-screen';
import { LibraryScreen } from './components/screens/library-screen';
import { SettingsScreen } from './components/screens/settings-screen';
import { WorkspaceScreen, type WorkspaceScreenHandle } from './components/screens/workspace-screen';
import { BottomBar, type MainTab } from './components/bottom-bar';
import { SettingsSheet } from './components/settings-sheet';
import { ComposeSheet, type ComposeMode } from './components/compose-sheet';
import { NewWorkSheet } from './components/new-work-sheet';
import { PhotoCrop } from './components/photo-crop';
import { CameraCapture } from './components/camera-capture';
import { ManageWorkSheet } from './components/manage-work-sheet';

const PHOTO_PROMPT = '请根据题图构建 GeoGebra 图形。';
const DEFAULT_BASE = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-flash';

type UndoSnapshot =
  | { kind: 'build'; workId: string }
  | { kind: 'modify'; workId: string; commands: string[]; thumbnail?: string };

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  const suffix = cause && cause !== error ? ` | ${errorText(cause)}` : '';
  return `${error.name}: ${error.message}${suffix}`;
}

function isAbort(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message));
}

/** 等 React 把工作台渲染到屏幕上，GeoGebra 才能拿到真实的画布尺寸。 */
function nextFrame() {
  return new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function workTitle(text: string, imageDataUrl: string | null, timestamp: number) {
  if (!imageDataUrl) {
    const firstLine = text.trim().split('\n')[0]?.replace(/\s+/g, ' ').trim();
    if (firstLine) return firstLine.slice(0, 24);
  }
  const time = new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `题图 · ${time}`;
}

/** 把画布截图压成小缩略图，作品库只存这一份 JPEG。 */
async function makeThumbnail(png: string) {
  try {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const width = 320;
    const height = 200;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    const sourceAspect = image.width / image.height;
    const targetAspect = width / height;
    let sx = 0;
    let sy = 0;
    let sw = image.width;
    let sh = image.height;
    if (sourceAspect > targetAspect) {
      sw = image.height * targetAspect;
      sx = (image.width - sw) / 2;
    } else {
      sh = image.width / targetAspect;
      sy = (image.height - sh) / 2;
    }
    context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch (error) {
    console.warn('[thumbnail]', error);
    return undefined;
  }
}

export default function App() {
  const [screen, setScreen] = useState<'main' | 'workspace'>('main');
  const [tab, setTab] = useState<MainTab>('home');
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [works, setWorks] = useState<WorkItem[]>(() => readWorks());
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newWorkOpen, setNewWorkOpen] = useState(false);
  const [managedWork, setManagedWork] = useState<WorkItem | null>(null);
  const [composeMode, setComposeMode] = useState<ComposeMode | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [settings, setSettings] = useState<SettingsValue>(() => ({
    protocol: readProtocol(),
    baseURL: localStorage.getItem(STORAGE_BASE) ?? DEFAULT_BASE,
    model: localStorage.getItem(STORAGE_MODEL) ?? DEFAULT_MODEL,
    apiKey: '',
  }));

  const canvasHostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<GgbCanvas | null>(null);
  const workspaceRef = useRef<WorkspaceScreenHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const currentWorkIdRef = useRef<string | null>(null);
  const undoRef = useRef<UndoSnapshot | null>(null);
  const promptedRef = useRef(false);
  const backHandlerRef = useRef<() => void>(() => {});
  const exitPressedAtRef = useRef(0);

  const providerReady = Boolean(settings.apiKey);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // 相机首帧出来之前保持首页状态栏，避免先黑一下再切回。
    const cropping = Boolean(pendingPhoto) || (cameraOpen && cameraReady);
    void StatusBar.setBackgroundColor({
      color: cropping ? '#0B0F0E' : screen === 'workspace' ? '#FFFFFF' : '#FDFCF8',
    }).catch(() => undefined);
    void StatusBar.setStyle({ style: cropping ? Style.Light : Style.Dark }).catch(() => undefined);
  }, [screen, pendingPhoto, cameraOpen, cameraReady]);

  // 返回键分层：先关浮层，再退工作台/回首页，首页连按两次才退出。
  useEffect(() => {
    backHandlerRef.current = () => {
      if (cameraOpen) {
        setCameraOpen(false);
        return;
      }
      if (pendingPhoto) {
        setPendingPhoto(null);
        return;
      }
      if (composeMode) {
        setComposeMode(null);
        return;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (newWorkOpen) {
        setNewWorkOpen(false);
        return;
      }
      if (managedWork) {
        setManagedWork(null);
        return;
      }
      if (workspaceRef.current?.closeOverlay()) return;
      if (screen === 'workspace') {
        leaveWorkspace();
        return;
      }
      if (tab !== 'home') {
        setTab('home');
        return;
      }

      const now = Date.now();
      if (now - exitPressedAtRef.current < 2000) {
        void CapacitorApp.exitApp();
        return;
      }
      exitPressedAtRef.current = now;
      toast('再按一次退出', { duration: 1800 });
    };
  }, [cameraOpen, pendingPhoto, composeMode, settingsOpen, newWorkOpen, managedWork, screen, tab, busy]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    let handle: { remove: () => Promise<void> } | undefined;
    void CapacitorApp.addListener('backButton', () => backHandlerRef.current()).then(listener => {
      if (disposed) void listener.remove();
      else handle = listener;
    });
    return () => {
      disposed = true;
      void handle?.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadApiKey().then(key => {
      if (cancelled) return;
      setSettings(current => (current.apiKey ? current : { ...current, apiKey: key }));
      setKeyLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!keyLoaded || promptedRef.current) return;
    if (!providerReady && works.length === 0) {
      promptedRef.current = true;
      setTab('settings');
    }
  }, [keyLoaded, providerReady, works.length]);

  function currentConfig(): AgentConfig | null {
    const baseURL = settings.baseURL.trim().replace(/\/+$/, '');
    const model = settings.model.trim();
    const apiKey = settings.apiKey;
    if (!baseURL || !model) {
      toast.error('请先在设置里填写 Base URL 和模型');
      return null;
    }
    if (!apiKey) {
      toast.error('请先在设置里填写 API Key');
      return null;
    }
    return { protocol: settings.protocol, baseURL, apiKey, model };
  }

  async function ensureCanvas() {
    if (canvasRef.current) return canvasRef.current;
    const host = canvasHostRef.current;
    if (!host) throw new Error('画布容器未就绪');
    const canvas = await createGgbCanvas(host);
    canvasRef.current = canvas;
    return canvas;
  }

  function handleEvent(event: SpikeEvent) {
    if (event.type === 'delta') {
      setProgress('正在整理…');
      return;
    }
    if (event.type === 'done') {
      setProgress('完成');
      return;
    }
    if (event.name === 'ggb_get_state') setProgress('正在读取画布…');
    else if (event.name === 'ggb_apply') {
      const input = event.input as { incremental?: boolean };
      setProgress(input.incremental ? '正在修改图形…' : '正在构建图形…');
    } else if (event.name === 'ggb_apply-result') setProgress('正在检查…');
  }

  async function startRun(mode: RunMode, text: string, imageDataUrl: string | null) {
    if (busy) return;
    const config = currentConfig();
    if (!config) {
      if (screen === 'main') setTab('settings');
      else setSettingsOpen(true);
      return;
    }

    if (mode === 'build') {
      setPhoto(imageDataUrl);
      currentWorkIdRef.current = null;
    }
    undoRef.current = null;
    setCanUndo(false);
    setScreen('workspace');
    setBusy(true);
    setProgress(mode === 'modify' ? '正在读取当前图形…' : '正在读题…');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await nextFrame();
      const ggb = await ensureCanvas();
      if (controller.signal.aborted) return;

      const currentWork = works.find(item => item.id === currentWorkIdRef.current);
      let beforeCommands: string[] | null = null;
      let beforeThumbnail: string | undefined;
      if (mode === 'modify') {
        const before = await ggb.getState();
        beforeCommands = (before.commands ?? []) as string[];
        beforeThumbnail = currentWork?.thumbnail;
      } else {
        // 新建前先清空旧画布，撤销时才能回到干净状态。
        await ggb.apply([], false);
      }

      await runAgent(
        config,
        mode,
        text,
        imageDataUrl,
        nativeFetch,
        ggb,
        handleEvent,
        controller.signal,
      );
      const current = await ggb.getState();
      const commands = (current.commands ?? []) as string[];
      const thumbnail = current.png ? await makeThumbnail(current.png) : undefined;
      const updatedAt = Date.now();
      const existing =
        mode === 'modify' && currentWorkIdRef.current
          ? readWorks().find(item => item.id === currentWorkIdRef.current)
          : undefined;
      const work: WorkItem = existing
        ? {
            ...existing,
            commands,
            updatedAt,
            thumbnail: thumbnail ?? existing.thumbnail,
          }
        : {
            id: crypto.randomUUID(),
            title: workTitle(text, imageDataUrl, updatedAt),
            commands,
            updatedAt,
            thumbnail,
          };
      currentWorkIdRef.current = work.id;
      setWorks(upsertWork(work));
      if (mode === 'modify' && existing && beforeCommands !== null) {
        undoRef.current = {
          kind: 'modify',
          workId: work.id,
          commands: beforeCommands,
          thumbnail: beforeThumbnail,
        };
      } else {
        undoRef.current = { kind: 'build', workId: work.id };
      }
      setCanUndo(true);
      toast.success(mode === 'modify' ? '修改完成' : '图形已生成');
    } catch (error) {
      if (isAbort(error)) toast('已取消');
      else toast.error(errorText(error));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  }

  function openCamera() {
    if (busy) return;
    setCameraReady(false);
    setCameraOpen(true);
  }

  async function takePhoto(source: CameraSource) {
    if (busy) return;
    try {
      const result = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source,
        quality: 75,
        width: 1600,
      });
      if (!result.dataUrl) throw new Error('没有拿到照片');
      setPendingPhoto(result.dataUrl);
    } catch (error) {
      const message = errorText(error);
      if (!/cancel/i.test(message)) toast.error(message);
    }
  }

  async function shareCurrent() {
    if (busy) return;
    const ggb = canvasRef.current;
    if (!ggb) {
      toast('还没有图形');
      return;
    }
    try {
      const current = await ggb.getState();
      if (!current.png) throw new Error('画布截图为空');
      await sharePng(current.png);
      toast.success('已打开分享');
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  async function restoreWork(work: WorkItem) {
    if (!work.commands.length) {
      toast('没有保存的图形');
      return;
    }
    currentWorkIdRef.current = work.id;
    undoRef.current = null;
    setCanUndo(false);
    setPhoto(null);
    setScreen('workspace');
    setProgress('正在恢复图形…');
    try {
      await nextFrame();
      const ggb = await ensureCanvas();
      await ggb.apply(work.commands, false);
      toast.success('已打开课件');
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setProgress(null);
    }
  }

  async function undoLast() {
    const snapshot = undoRef.current;
    if (!snapshot || busy) return;
    const ggb = canvasRef.current;
    if (!ggb) {
      toast('还没有画布');
      return;
    }
    setBusy(true);
    setProgress('正在撤销…');
    try {
      if (snapshot.kind === 'build') {
        await ggb.apply([], false);
        setWorks(removeWorkFromStore(snapshot.workId));
        if (currentWorkIdRef.current === snapshot.workId) currentWorkIdRef.current = null;
        setPhoto(null);
        setScreen('main');
        toast.success('已撤销本次生成');
      } else {
        await ggb.apply(snapshot.commands, false);
        const existing = readWorks().find(item => item.id === snapshot.workId);
        if (existing) {
          setWorks(
            upsertWork({
              ...existing,
              commands: snapshot.commands,
              updatedAt: Date.now(),
              thumbnail: snapshot.thumbnail,
            }),
          );
        }
        toast.success('已撤销上次修改');
      }
      undoRef.current = null;
      setCanUndo(false);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function resetCanvas() {
    canvasRef.current?.reset();
    setPhoto(null);
    currentWorkIdRef.current = null;
    undoRef.current = null;
    setCanUndo(false);
    setScreen('main');
    toast('画布已清空，课件已保留');
  }

  function renameWork(work: WorkItem, title: string) {
    setWorks(updateWorkTitle(work.id, title));
    setManagedWork(null);
    toast.success('已重命名');
  }

  function deleteWorkItem(work: WorkItem) {
    setWorks(removeWorkFromStore(work.id));
    if (currentWorkIdRef.current === work.id) currentWorkIdRef.current = null;
    setManagedWork(null);
    toast.success('已删除');
  }

  function cancelRun() {
    if (!busy) return;
    abortRef.current?.abort();
    setProgress('正在取消…');
  }

  function leaveWorkspace() {
    if (busy) cancelRun();
    setScreen('main');
  }

  function retake() {
    if (busy) cancelRun();
    setPhoto(null);
    setScreen('main');
  }

  function saveSettings(next: SettingsValue) {
    const baseURL = next.baseURL.trim().replace(/\/+$/, '');
    const model = next.model.trim();
    const apiKey = next.apiKey.trim() || settings.apiKey;
    setSettings({ protocol: next.protocol, baseURL, model, apiKey });
    localStorage.setItem(STORAGE_PROTOCOL, next.protocol);
    localStorage.setItem(STORAGE_BASE, baseURL);
    localStorage.setItem(STORAGE_MODEL, model);
    void saveApiKey(apiKey).catch(error => {
      console.warn('[secure-key]', error);
      toast.error('API Key 保存失败');
    });
  }

  async function testSettings(next: SettingsValue) {
    const baseURL = next.baseURL.trim().replace(/\/+$/, '');
    const model = next.model.trim();
    const apiKey = next.apiKey.trim() || settings.apiKey;
    if (!baseURL || !model) throw new Error('请填写 Base URL 和模型');
    if (!apiKey) throw new Error('请填写 API Key');
    await testProvider({ protocol: next.protocol, baseURL, apiKey, model }, nativeFetch);
  }

  const currentWork = works.find(item => item.id === currentWorkIdRef.current) ?? null;

  return (
    <div className="h-full">
      <div className={screen === 'main' ? 'flex h-full flex-col' : 'hidden'}>
        <div className="relative min-h-0 flex-1">
          <HomeScreen
            hidden={tab !== 'home'}
            busy={busy}
            works={works}
            configured={!keyLoaded || providerReady}
            onTakePhoto={openCamera}
            onPickPhoto={() => void takePhoto(CameraSource.Photos)}
            onComposeText={() => setComposeMode('text')}
            onOpenWork={work => void restoreWork(work)}
            onManageWork={work => setManagedWork(work)}
            onOpenWorks={() => setTab('works')}
            onConfigure={() => setTab('settings')}
          />

          <LibraryScreen
            hidden={tab !== 'works'}
            busy={busy}
            works={works}
            onNew={() => setNewWorkOpen(true)}
            onOpenWork={work => void restoreWork(work)}
            onManageWork={work => setManagedWork(work)}
          />

          <SettingsScreen
            hidden={tab !== 'settings'}
            initial={settings}
            onSave={saveSettings}
            onTest={testSettings}
          />
        </div>

        <BottomBar active={tab} onChange={setTab} />
      </div>

      <WorkspaceScreen
        ref={workspaceRef}
        hidden={screen !== 'workspace'}
        busy={busy}
        title={currentWork?.title ?? '新图形'}
        canUndo={canUndo}
        photo={photo}
        progress={progress}
        canvasRef={canvasHostRef}
        onBack={leaveWorkspace}
        onRetake={retake}
        onModify={() => {
          if (!canvasRef.current) {
            toast('还没有可修改的图形');
            return;
          }
          setComposeMode('modify');
        }}
        onShare={() => void shareCurrent()}
        onCancel={cancelRun}
        onUndo={() => void undoLast()}
        onReset={resetCanvas}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initial={settings}
        onSave={saveSettings}
        onTest={testSettings}
      />

      <ComposeSheet
        mode={composeMode}
        onClose={() => setComposeMode(null)}
        onSubmit={(mode, text) => {
          setComposeMode(null);
          void startRun(mode === 'modify' ? 'modify' : 'build', text, null);
        }}
      />

      <NewWorkSheet
        open={newWorkOpen}
        onOpenChange={setNewWorkOpen}
        onTakePhoto={() => {
          setNewWorkOpen(false);
          openCamera();
        }}
        onPickPhoto={() => {
          setNewWorkOpen(false);
          void takePhoto(CameraSource.Photos);
        }}
        onText={() => {
          setNewWorkOpen(false);
          setComposeMode('text');
        }}
      />

      {cameraOpen && (
        <CameraCapture
          onClose={() => setCameraOpen(false)}
          onCapture={dataUrl => {
            setCameraOpen(false);
            setPendingPhoto(dataUrl);
          }}
          onPickPhoto={() => {
            setCameraOpen(false);
            void takePhoto(CameraSource.Photos);
          }}
          onUseSystemCamera={() => {
            setCameraOpen(false);
            void takePhoto(CameraSource.Camera);
          }}
          onFirstFrame={() => setCameraReady(true)}
        />
      )}

      {pendingPhoto && (
        <PhotoCrop
          key={pendingPhoto}
          src={pendingPhoto}
          onCancel={() => setPendingPhoto(null)}
          onConfirm={cropped => {
            setPendingPhoto(null);
            void startRun('build', PHOTO_PROMPT, cropped);
          }}
        />
      )}

      <ManageWorkSheet
        work={managedWork}
        onClose={() => setManagedWork(null)}
        onRename={renameWork}
        onDelete={deleteWorkItem}
      />

      <Toaster
        position="bottom-center"
        theme="light"
        richColors
        visibleToasts={2}
        offset={{ bottom: 'calc(84px + env(safe-area-inset-bottom))' }}
        mobileOffset={{ bottom: 'calc(84px + env(safe-area-inset-bottom))' }}
      />
    </div>
  );
}
