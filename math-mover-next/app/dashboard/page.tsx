'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CloudUpload,
  FileDown,
  RefreshCw,
  MoreHorizontal,
  LayoutGrid,
  ChevronDown,
  PenTool,
  Loader2,
  Maximize2,
  X,
  Clock,
  ArrowRight,
  Check,
  Copy
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import GeoGebraBoard from '../../components/GeoGebraBoard';
import { TYPE_MAP, formatGenerationTitle, TOAST_DURATION_MS } from '@/lib/constants';
import {
  GenerationRecord,
  listGenerations,
  getGeneration,
  saveGeneration,
  makeThumbnail,
  onGenerationsChanged,
} from '@/lib/local-store';
import { auditConstruction } from '@/lib/ggb-audit';

const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024;

// 类型定义
interface GeoGebraApi {
  newConstruction: () => void;
  setPerspective: (p: string) => void;
  setAxesVisible: (x: boolean, y: boolean, z?: boolean) => void;
  setGridVisible: (v: boolean) => void;
  evalCommand: (cmd: string) => boolean | void;
  getValue: (name: string) => number;
  setValue: (name: string, val: number) => void;
  registerUpdateListener: (fn: (name: string) => void) => void;
  unregisterUpdateListener: (fn: (name: string) => void) => void;
  getBase64: (cb: (b64: string) => void) => void;
  getViewProperties?: (view: number) => unknown; // 视图就绪探针（异步重建检测）
  refreshViews: () => void;
  recalcDisplay?: () => void;
  getAllObjectNames: () => string[];
  getObjectType: (name: string) => string;
  getValueString?: (name: string) => string;
  isIndependent: (name: string) => boolean;
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-[#FDFCF8] text-stone-500">正在加载工作台...</div>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("准备中...");
  const [isGenerated, setIsGenerated] = useState(false);
  const [ggbApplet, setGgbApplet] = useState<GeoGebraApi | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [progress, setProgress] = useState(0); 
  const [problemType, setProblemType] = useState<string | null>(null); 
  const [routerInfo, setRouterInfo] = useState<Record<string, unknown> | null>(null);
  const routerInfoRef = useRef<Record<string, unknown> | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false); 
  const [isPreviewImageOpen, setIsPreviewImageOpen] = useState(false); 
  const [sliders, setSliders] = useState<{name: string, value: number | string, min: number, max: number}[]>([]); 
  const [activeSliderName, setActiveSliderName] = useState<string | null>(null); 
  const [problemText, setProblemText] = useState('');
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | null }>({ message: '', type: null });

  const [pendingCommands, setPendingCommands] = useState<string[]>([]);
  const [executedCommands, setExecutedCommands] = useState<string[]>([]);
  const [isCopied, setIsCopied] = useState(false);
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [lastUploadedUrl, setLastUploadedUrl] = useState<string | null>(null);
  const [isGgbCommandsExpanded, setIsGgbCommandsExpanded] = useState(false);

  // 全局 Escape 键监听
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false);
        }
        if (isPreviewImageOpen) {
          setIsPreviewImageOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isFullscreen, isPreviewImageOpen]);

  // 文本框 Ctrl+Enter 提交生成
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!isLoading && (previewUrl || problemText.trim())) {
        if (isGenerated) {
          handleRegenerate();
        } else {
          handleGenerate();
        }
      }
    }
  };

  // 显示 Toast 提示
  const showToast = (message: string, type: 'success' | 'error') => {
      setToast({ message, type });
      setTimeout(() => setToast({ message: '', type: null }), TOAST_DURATION_MS);
  };

  const parseUploadError = async (response: Response) => {
      const errorText = await response.text();
      let message = errorText;

      try {
          const data = JSON.parse(errorText);
          message = data.message || data.error || errorText;
      } catch {}

      if (
          message.includes('invalid_api_key') ||
          message.includes('Incorrect API key') ||
          message.includes('apikey-error')
      ) {
          return 'API Key 无效。请在侧边栏「模型设置」中重新粘贴正确的 API Key，并确认没有多余空格或换行。';
      }

      return message || `请求失败 (${response.status})`;
  };

  const postUpload = async (formData: FormData) => fetch('/api/upload', {
      method: 'POST',
      body: formData
  });
  
  // 历史项目切换相关
  const [recentHistory, setRecentHistory] = useState<GenerationRecord[]>([]);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  // 指令执行会话令牌：切换题目时递增，旧执行流的定时器触发后自毁，防止交错执行
  const execSessionRef = useRef(0);
  const currentHistoryId = searchParams.get('history_id');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [currentProjectTitle, setCurrentProjectTitle] = useState<string>("未命名课件");

  // 点击外部关闭项目菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(event.target as Node)) {
        setIsProjectMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  
  
  // 初始化：加载本地历史（去 SaaS 化，无登录态）
  useEffect(() => {
    refreshRecentHistory();
  }, []);

  // 监听本地历史变化（生成/删除后同步）
  useEffect(() => {
    return onGenerationsChanged(refreshRecentHistory);
  }, []);

  // 监听 URL 参数变化 (响应 Sidebar 操作)
  useEffect(() => {
      const action = searchParams.get('action');
      const historyId = searchParams.get('history_id');

      // 1. 处理新建 (由 Sidebar 触发)
      if (action === 'new') {
          setFile(null);
          setPreviewUrl(null);
          setIsGenerated(false);
          setProblemText('');
          setProblemType(null);
          setProgress(0);
          setCurrentProjectTitle("未命名课件");
          setLastUploadedFile(null);
          setLastUploadedUrl(null);
          setActiveProjectId(null);
          setSavedImageUrl(null);
          if (ggbApplet) ggbApplet.newConstruction();
          router.replace('/dashboard');
      }

      if (historyId) {
          setActiveProjectId(historyId);
          fetchHistoryItem(historyId);
      }
  }, [router, searchParams, ggbApplet]);

  const refreshRecentHistory = () => {
    setRecentHistory(listGenerations().slice(0, 5));
  };

  const fetchHistoryItem = (id: string) => {
      const record = getGeneration(id);
      if (record) {
          loadHistoryItem(record);
      }
  };

  const handleSwitchProject = (item: GenerationRecord) => {
      setIsProjectMenuOpen(false);
      router.push(`/dashboard?history_id=${item.id}`);
  };

  // 加载历史记录项
  const loadHistoryItem = (item: GenerationRecord) => {
      // 1. 恢复图片预览（本地缩略图）
      if (item.thumbnail) {
          setPreviewUrl(item.thumbnail);
          setSavedImageUrl(item.thumbnail);
      } else {
          setPreviewUrl(null);
          setSavedImageUrl(null);
      }

      // 2. 恢复题型
      setProblemType(item.problem_type || null);
      setRouterInfo((item.router_meta as Record<string, unknown>) || null);

      // 3. 更新标题
      setCurrentProjectTitle(formatGenerationTitle(item.title, item.problem_type));

      // 4. 恢复指令
      if (Array.isArray(item.commands) && item.commands.length > 0) {
          setPendingCommands(item.commands);
          setExecutedCommands(item.commands);
          setIsGenerated(true);
      }
  };

  // 监听粘贴事件
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                const blob = item.getAsFile();
                if (blob) handleFileSelect(blob);
                break;
            }
        }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // 模拟进度条动画和文案
  useEffect(() => {
    let progressInterval: NodeJS.Timeout;
    let textInterval: NodeJS.Timeout;

    const statusMessages = [
        "正在识别题目图像信息...",
        "AI 正处于推导几何约束关系...",
        "正在构建动点与参数逻辑...",
        "正在生成 GeoGebra 绘图指令...",
        "正在进行最终渲染检查..."
    ];

    if (isLoading) {
      progressInterval = setInterval(() => {
        setProgress((prev) => {
             if (prev >= 90) {
                 return prev;
             }
             const increment = (90 - prev) / 100; 
             return prev + (increment < 0.08 ? 0.08 : increment);
        });
      }, 100);

      let i = 0;
      textInterval = setInterval(() => {
        i++;
        if (i < statusMessages.length) {
            setLoadingText(statusMessages[i]);
        } else {
            clearInterval(textInterval);
        }
      }, 7000);

    } 
    
    return () => {
        if (progressInterval) clearInterval(progressInterval);
        if (textInterval) clearInterval(textInterval);
    };
  }, [isLoading]);

  // 核心逻辑 - 嗅探滑块
  const detectSliders = (api: GeoGebraApi) => {
      if (!api) return;
      
      const allObjects = api.getAllObjectNames();
      const newSliders: {name: string, value: number | string, min: number, max: number}[] = [];
      
      allObjects.forEach((name: string) => {
          if (api.getObjectType(name) === 'numeric') {
              const val = api.getValue(name);
              if (api.isIndependent(name)) {
                  try {
                      newSliders.push({
                          name: name,
                          value: val,
                          min: -10, 
                          max: 10
                      });
                  } catch (e) {}
              }
          }
      });
      setSliders(newSliders.slice(0, 5));
  };

  // 双向绑定：监听 GGB 更新
  useEffect(() => {
      if (!ggbApplet || !isGenerated) return;

      const onUpdate = (objName: string) => {
          if (objName === activeSliderName) return;

          setSliders(prevSliders => {
              const index = prevSliders.findIndex(s => s.name === objName);
              if (index !== -1) {
                  const newVal = ggbApplet.getValue(objName);
                  const currentVal = prevSliders[index].value;
                  
                  if (typeof currentVal === 'number' && Math.abs(currentVal - newVal) < 0.0001) {
                      return prevSliders;
                  }
                  
                  const newSliders = [...prevSliders];
                  newSliders[index] = { ...newSliders[index], value: newVal };
                  return newSliders;
              }
              return prevSliders;
          });
      };

      ggbApplet.registerUpdateListener(onUpdate);
      detectSliders(ggbApplet);

      return () => {
          if (ggbApplet && ggbApplet.unregisterUpdateListener) {
              ggbApplet.unregisterUpdateListener(onUpdate);
          }
      };
  }, [ggbApplet, isGenerated, activeSliderName]);

  // React 控制 GGB
  const handleSliderChange = (name: string, inputVal: string) => {
      setSliders(prev => prev.map(s => s.name === name ? { ...s, value: inputVal } : s));
      const numVal = parseFloat(inputVal);
      if (!isNaN(numVal) && inputVal !== '' && inputVal !== '-') {
           if (ggbApplet) {
               ggbApplet.setValue(name, numVal);
           }
      }
  };

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>, name: string) => {
      setActiveSliderName(name); 
      e.target.select(); 
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
          e.currentTarget.blur();
      }
  };

  const handleInputBlur = (name: string) => {
      setActiveSliderName(null); 
      if (ggbApplet) {
          const realVal = ggbApplet.getValue(name);
          setSliders(prev => prev.map(s => s.name === name ? { ...s, value: realVal } : s));
      }
  };

  // 监听 GeoGebra 实例就绪并执行待处理指令
  useEffect(() => {
    if (ggbApplet && pendingCommands.length > 0) {
        const session = ++execSessionRef.current;

        ggbApplet.newConstruction(); 
        
        setTimeout(() => {
            const commandsToRun = [...pendingCommands];
            let currentMode = '2D'; 
    
            const modeIndex = commandsToRun.findIndex(cmd => cmd.startsWith('MODE:'));
            
            if (modeIndex !== -1) {
                const modeCmd = commandsToRun[modeIndex];
                commandsToRun.splice(modeIndex, 1);
                
                if (modeCmd.includes('3D')) {
                    currentMode = '3D';
                } else if (modeCmd.includes('2D')) {
                    currentMode = '2D';
                }
            } else {
                if (problemType === 'D') {
                    currentMode = '3D';
                }
            }
    
            if (currentMode === '2D') {
                // setPerspective 是 API 方法而非几何命令：evalCommand 字符串形式
                // 在 3D→2D 切换时静默失败（视图残留 3D），必须用方法调用（与 3D 分支一致）
                ggbApplet.setPerspective("G");
                ggbApplet.setAxesVisible(true, true);
                ggbApplet.setGridVisible(true);
            } else {
                ggbApplet.setPerspective("T");
                ggbApplet.setAxesVisible(true, true, true);
                ggbApplet.setGridVisible(true);
            }

            // 视图就绪等待：setPerspective 是异步重建视图（尤其 3D→2D 切换），
            // 固定延时不可靠——视图未就绪时 evalCommand 会画进错误的空间或静默失败。
            // 探针：2D 等视图1可用，3D 等视图2出现；每 100ms 轮询，上限 3s。
            const waitForView = (cb: () => void) => {
                const viewIndex = currentMode === '2D' ? 1 : 2;
                let waited = 0;
                const tick = () => {
                    if (execSessionRef.current !== session) return; // 已切题，放弃
                    let ready = false;
                    try {
                        ready = typeof ggbApplet.getViewProperties === 'function'
                            ? !!ggbApplet.getViewProperties(viewIndex)
                            : true;
                    } catch {
                        ready = false;
                    }
                    if (ready) { cb(); return; }
                    if (waited >= 3000) { cb(); return; } // 探针不可用时退化为定时执行
                    waited += 100;
                    setTimeout(tick, 100);
                };
                setTimeout(tick, 100);
            };

            waitForView(() => {
                if (execSessionRef.current !== session) return; // 已切题，旧执行流自毁
                const execList = (list: string[]) => {
                    const failed: string[] = [];
                    list.forEach((cmd) => {
                         try {
                             const cleanCmd = cmd.replace(/\\"/g, '"');
                             // 注意：GGB 的 evalCommand 对属性命令即使成功也返回 false，
                             // 返回值只用于筛选重放候选，不作为最终失败依据
                             const ok = ggbApplet.evalCommand(cleanCmd);
                             if (ok === false) failed.push(cmd);
                         } catch (err) {
                             console.error('❌ 执行失败:', cmd, err);
                             failed.push(cmd);
                         }
                    });
                    return failed;
                };

                // 第一遍：建立对象（属性命令若先于对象定义会被 GGB 静默丢弃）
                const failed = execList(commandsToRun);
                // 第二遍：补属性 + 兜底 setPerspective 异步重建期间的竞态丢失
                if (failed.length > 0) {
                    setTimeout(() => {
                        if (execSessionRef.current !== session) return; // 已切题，旧执行流自毁
                        execList(failed);
                    }, 500);
                }

                // 全量体检：缺失 + 未定义（假成功）都计为破损。
                // 不能只查失败行——case-01 的未定义点 evalCommand 返回 true 却是 (?,?)，
                // 连坐下游静默失败；等两遍重放落定再体检。
                setTimeout(() => {
                    if (execSessionRef.current !== session) return; // 已切题，旧执行流自毁
                    const audit = auditConstruction(ggbApplet, commandsToRun);
                    if (audit.degraded) {
                        console.warn('[MathMover] getValueString 不可用，未定义对象检测已降级为仅缺失检测');
                    }
                    if (audit.findings.length > 0) {
                        console.warn(`[MathMover] ${audit.findings.length}/${commandsToRun.length} 个对象破损`, audit.findings);
                        const parts: string[] = [];
                        if (audit.missing.length > 0) parts.push(`${audit.missing.length} 个缺失`);
                        if (audit.undefinedObjs.length > 0) parts.push(`${audit.undefinedObjs.length} 个未定义`);
                        showToast(`有 ${parts.join('、')}对象，图形可能不完整`, 'error');
                    }
                }, 800);
                
                ggbApplet.evalCommand('SetFontSize(10)');

                if (currentMode === '2D') {
                    // 视窗自适应：按题目坐标的尺度与质心定视野。
                    // 固定 CenterView((0,0)) + ZoomIn(-10) 会让大坐标题（如按实际尺寸
                    // 建模的 160x120 矩形）整个落在视野外，用户看到空白坐标系。
                    const coords: number[][] = [];
                    commandsToRun.forEach((cmd) => {
                        const pairs = cmd.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g);
                        for (const p of pairs) {
                            coords.push([parseFloat(p[1]), parseFloat(p[2])]);
                        }
                    });
                    const maxAbs = Math.max(0, ...coords.flat().map(Math.abs));
                    if (maxAbs > 12 && coords.length > 0) {
                        const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
                        const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
                        const factor = 10 / (maxAbs * 1.6);
                        ggbApplet.evalCommand(`CenterView((${cx.toFixed(2)}, ${cy.toFixed(2)}))`);
                        ggbApplet.evalCommand(`ZoomIn(${factor.toFixed(4)})`);
                    } else {
                        ggbApplet.evalCommand('CenterView((0,0))');
                        ggbApplet.evalCommand('ZoomIn(-10)');
                    }
                }
        
                ggbApplet.refreshViews();
                
                if (ggbApplet.recalcDisplay) {
                    ggbApplet.recalcDisplay();
                }
        
                setPendingCommands([]);

                setTimeout(() => {
                    if (execSessionRef.current === session) detectSliders(ggbApplet);
                }, 500);
            }); // waitForView
        }, 50);
    }
  }, [ggbApplet, pendingCommands]);

  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile || !selectedFile.type.startsWith('image/')) {
      showToast('请上传有效的图片文件 (JPG, PNG).', 'error');
      return;
    }
    if (selectedFile.size > MAX_UPLOAD_IMAGE_BYTES) {
      showToast('上传的图片不能超过 5MB，请压缩后再试。', 'error');
      return;
    }
    setFile(selectedFile);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(selectedFile);
    
    setIsGenerated(false);
    setProblemType(null);
    setProblemText(''); 
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  };

  const handleRegenerate = () => {
    // 立即触发生成
    handleGenerate();
  };

  const toggleFullscreen = (value: boolean) => {
    setIsFullscreen(value);
  };
  
  useEffect(() => {
    if (isFullscreen) {
        const handleResize = () => {
            const container = document.querySelector('.ggb-fullscreen-wrapper') as HTMLElement;
            if (container) {
                const scale = Math.min(window.innerWidth / 900, window.innerHeight / 600) * 0.95;
                container.style.setProperty('--ggb-scale', scale.toString());
            }
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }
  }, [isFullscreen]);

  const handleGenerate = async () => {
    // 允许无文件生成：只要有 file、previewUrl 或者 problemText 即可继续
    if (!file && !previewUrl && !problemText.trim()) return;

    setIsLoading(true);
    setIsGenerated(false);
    setProgress(0);
    setLoadingText("正在识别题目图像信息...");
    setProblemType(null);

    if (ggbApplet) {
      ggbApplet.newConstruction();
    }

    const formData = new FormData();
    if (file) {
        formData.append('file', file);
    }

    if (problemText) {
        formData.append('text', problemText);
    }
    formData.append('responseMode', 'stream');

    try {
      const response = await postUpload(formData);

      if (!response.ok) {
        throw new Error(await parseUploadError(response));
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completedReceived = false;

      if (!reader) throw new Error('Response body is unavailable');

      while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; 
          
          for (const line of lines) {
              if (!line.trim()) continue;
              
              try {
                  const data = JSON.parse(line);
                  
                  if (data.error || data.status === 'error') {
                      const message = data.message || data.error || '生成失败，请稍后重试';
                      showToast('Error: ' + message, 'error');
                      setIsLoading(false);
                      try {
                        await reader.cancel();
                      } catch {}
                      return;
                  }

                  if (data.status === 'classified') {
                      setProblemType(data.category);
                      setRouterInfo(data.router || null);
                      routerInfoRef.current = data.router || null;
                      setLoadingText("正在调用专家模型生成指令...");
                  } else if (data.status === 'processing') {
                      setLoadingText(data.message || "正在调用专家模型生成指令...");
                  } else if (data.status === 'completed') {
                      completedReceived = true;
                      
                      const rawData = data.commands;
                      const validCommands: string[] = [];

                      if (Array.isArray(rawData)) {
                          rawData.forEach((item: string) => {
                              const subLines = item.split(/\r?\n|\\n/);
                              subLines.forEach(line => {
                                  const cmd = line.trim();
                                  if (
                                      cmd && 
                                      !cmd.startsWith('//') && 
                                      !cmd.startsWith('```') && 
                                      !cmd.startsWith('**') && 
                                      !cmd.match(/[\u4e00-\u9fa5]/) 
                                  ) {
                                      validCommands.push(cmd);
                                  }
                              });
                          });
                      } else if (typeof rawData === 'string') {
                          const lines = rawData.split(/\r?\n|\\n/);
                          for (const line of lines) {
                            const cmd = line.trim();
                            if (
                                cmd && 
                                !cmd.startsWith('//') && 
                                !cmd.startsWith('```') && 
                                !cmd.startsWith('**') && 
                                !cmd.match(/[\u4e00-\u9fa5]/) 
                            ) {
                                validCommands.push(cmd);
                            }
                          }
                      }
                      
                      setPendingCommands(validCommands);
                      setExecutedCommands(validCommands);

                      // 保存到本地历史（localStorage）
                      try {
                          // 纯文本生成无图：跳过缩略图，但记录必须照常落盘（否则 router_meta 等审验信息丢失）
                          const thumbnail = file ? await makeThumbnail(file) : undefined;
                          const saved = saveGeneration({
                              id: activeProjectId || undefined,
                              title: currentProjectTitle === '未命名课件' ? '' : currentProjectTitle,
                              commands: validCommands,
                              problem_type: data.category,
                              category: data.category,
                              router_meta: routerInfoRef.current,
                              thumbnail,
                          });
                          setActiveProjectId(saved.id);
                          if (thumbnail) setSavedImageUrl(thumbnail);
                      } catch (err) {
                          console.error('Failed to save local history:', err);
                      }
                      
                      const finishTimer = setInterval(() => {
                        setProgress((prev) => {
                            if (prev >= 100) {
                                clearInterval(finishTimer);
                                return 100;
                            }
                            return Math.min(prev + 2, 100); 
                        });
                      }, 30);

                      setTimeout(() => {
                          clearInterval(finishTimer);
                          setProgress(100); 
                          setLoadingText("生成完成！即将展示..."); 
                          
                          setTimeout(() => {
                              setIsGenerated(true);
                              setIsLoading(false); 
                          }, 600);
                      }, 600);
                  }
              } catch (e) {
                  console.error('Error parsing JSON chunk:', e);
                  const message = e instanceof Error ? e.message : '生成响应解析失败';
                  showToast('Error: ' + message, 'error');
                  setIsLoading(false);
                  try {
                    await reader.cancel();
                  } catch {}
                  return;
              }
          }
      }

      if (!completedReceived) {
        throw new Error('生成连接中断，请刷新后重试。');
      }

    } catch (err: unknown) {
      console.error(err);
      showToast('Error: ' + ((err as Error).message || 'Unknown error'), 'error');
      setIsLoading(false); 
    } 
  };

  const handleCopyCommands = () => {
    if (executedCommands.length === 0) return;
    const text = executedCommands.join('\n');
    navigator.clipboard.writeText(text).then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const handleExport = (type: 'html' | 'ggb') => {
    if (!ggbApplet || !isGenerated) return;

    ggbApplet.getBase64((base64: string) => {
      if (!base64) {
        showToast('无法获取 GGB 数据', 'error');
        return;
      }

      // 生成动态文件名
      const now = new Date();
      const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      
      // 优先使用当前项目标题，如果没有则使用题型，再没有则使用“演示”
      const projectName = currentProjectTitle && currentProjectTitle !== "未命名课件" 
        ? currentProjectTitle 
        : (problemType || "演示");
      
      const safeProjectName = projectName.replace(/[\\/:*?"<>|]/g, '_'); // 过滤非法字符
      const baseFilename = `MathMover_${safeProjectName}_${timestamp}`;

      if (type === 'ggb') {
        downloadBlob(base64ToBlob(base64, 'application/vnd.geogebra.file'), `${baseFilename}.ggb`);
      } else {
        const htmlContent = generateExportHTML(base64);
        downloadBlob(new Blob([htmlContent], { type: 'text/html' }), `${baseFilename}.html`);
      }
      setIsExportMenuOpen(false);
    });
  };

  const base64ToBlob = (base64: string, mimeType: string) => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], {type: mimeType});
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const generateExportHTML = (base64: string) => {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MathMover 交互课件</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-color: #FDFCF8;
            --card-bg: #FFFFFF;
            --text-primary: #1c1917;
            --text-secondary: #78716c;
            --accent-color: #10b981;
            --border-color: #e7e5e4;
        }
        
        * { box-sizing: border-box; }
        
        body {
            margin: 0;
            padding: 0;
            min-height: 100vh;
            font-family: 'Inter', 'Noto Sans SC', sans-serif;
            background-color: var(--bg-color);
            color: var(--text-primary);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
        }

        /* 顶部品牌栏 */
        .header {
            width: 100%;
            max-width: 1000px;
            padding: 20px 4px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-bottom: 12px;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .logo-box {
            width: 36px;
            height: 36px;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 900;
            font-size: 20px;
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
        }

        .title {
            font-size: 18px;
            font-weight: 800;
            color: var(--text-primary);
            letter-spacing: -0.02em;
        }

        .subtitle {
            font-size: 12px;
            font-weight: 600;
            color: var(--text-secondary);
            opacity: 0.8;
            text-decoration: none;
            transition: opacity 0.2s;
        }
        .subtitle:hover { opacity: 1; color: var(--accent-color); }

        /* 画板容器 */
        .canvas-container {
            width: 100%;
            max-width: 1000px;
            background: var(--card-bg);
            border-radius: 24px;
            box-shadow: 
                0 20px 25px -5px rgba(0, 0, 0, 0.05), 
                0 8px 10px -6px rgba(0, 0, 0, 0.01),
                0 0 0 1px rgba(0,0,0,0.02); /* 微边框 */
            border: 1px solid var(--border-color);
            overflow: hidden; /* 关键：裁剪圆角 */
            position: relative;
            aspect-ratio: 16/10; /* 保持比例 */
        }

        #ggb-element {
            width: 100%;
            height: 100%;
            display: block;
        }

        /* 强制覆盖 GeoGebra 样式 */
        .applet_container, canvas {
            border: none !important;
            outline: none !important;
            border-radius: 0 !important; /* 让容器控制圆角 */
        }
        
        /* 隐藏加载条背景 */
        .gwt-ProgressBar-shell {
            border: none !important;
        }

        /* 响应式适配 */
        @media (max-width: 1040px) {
            .header, .canvas-container {
                width: 92%;
            }
            .canvas-container {
                border-radius: 16px;
            }
        }
    </style>
</head>
<body>
    
    <div class="header">
        <div class="brand">
            <div class="logo-box">M</div>
            <div class="title">MathMover 交互课件</div>
        </div>
        <a href="https://mathmover.top" target="_blank" class="subtitle">Powered by MathMover.top</a>
    </div>

    <div class="canvas-container">
        <div id="ggb-element"></div>
    </div>

    <script src="https://www.geogebra.org/apps/deployggb.js"></script>
    <script>
        var params = {
            "appName": "classic",
            "width": 1000,
            "height": 625,
            "showToolBar": false,
            "showAlgebraInput": false,
            "showMenuBar": false,
            "showResetIcon": true,
            "enableLabelDrags": false,
            "enableShiftDragZoom": true,
            "enableRightClick": false,
            "borderColor": "transparent",
            "ggbBase64": "${base64}"
        };
        
        // 自动响应式缩放
        function updateDimensions() {
            var container = document.querySelector('.canvas-container');
            if(applet && container) {
                // 保持 16:10 比例，或者根据容器宽度自适应
                // GeoGebra 会自动填充父容器
            }
        }

        var applet = new GGBApplet(params, true);
        window.onload = function() { 
            applet.inject('ggb-element');
        };
    </script>
</body>
</html>`;
  };

  // 渲染逻辑：只保留 Main 和 Right Panel
  // Left Sidebar 已移除
  
  return (
    <div className="flex h-full w-full bg-[#FDFCF8] font-sans text-stone-800 overflow-hidden selection:bg-emerald-100 selection:text-emerald-900">
      
      {/* Global Toast Notification */}
      <AnimatePresence>
          {toast.type && (
              <motion.div
                  initial={{ opacity: 0, y: -50, x: '-50%' }}
                  animate={{ opacity: 1, y: 0, x: '-50%' }}
                  exit={{ opacity: 0, y: -20, x: '-50%' }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  className={`fixed top-10 left-1/2 z-[10001] px-6 py-3 rounded-full backdrop-blur-md shadow-lg border flex items-center gap-2 ${
                      toast.type === 'success' 
                      ? 'bg-emerald-50/90 border-emerald-200 text-emerald-700' 
                      : 'bg-red-50/90 border-red-200 text-red-600'
                  }`}
              >
                  {toast.type === 'success' ? (
                      <Check className="w-4 h-4 stroke-[3]" />
                  ) : (
                      <X className="w-4 h-4 stroke-[3]" />
                  )}
                  <span className="text-sm font-bold">{toast.message}</span>
              </motion.div>
          )}
      </AnimatePresence>

      {/* 2. Middle Canvas Area (Fluid) */}
      <main className="flex-1 relative flex flex-col bg-[#F5F5F0]/50 h-full overflow-hidden">
        
        {/* Header */}
        {!isFullscreen && (
          <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between p-4 pointer-events-none">
             <div 
                ref={projectMenuRef}
                className="pointer-events-auto relative"
             >
                 {/* 触发按钮 */}
                 <div className="flex items-center gap-2 bg-white/40 backdrop-blur-md border border-stone-200/50 shadow-sm px-1 py-1 rounded-xl pl-3 opacity-90 hover:opacity-100 hover:bg-white/80 transition-all duration-300">
                    <span className="text-xs font-bold text-stone-500">项目 /</span>
                    <div 
                        onClick={() => setIsProjectMenuOpen(!isProjectMenuOpen)}
                        className="flex items-center gap-1 cursor-pointer hover:bg-stone-50/50 px-2 py-1 rounded-lg -ml-1 transition-colors group"
                    >
                        <h1 className="font-bold text-sm text-stone-700 group-hover:text-emerald-600 transition-colors truncate max-w-[150px]">
                            {currentProjectTitle}
                        </h1>
                        <ChevronDown className={`w-3 h-3 text-stone-400 group-hover:text-emerald-500 stroke-[3] transition-transform duration-200 ${isProjectMenuOpen ? 'rotate-180' : ''}`} />
                    </div>
                 </div>

                 {/* 下拉菜单 (Popover Style) */}
                 <AnimatePresence>
                    {isProjectMenuOpen && (
                        <motion.div 
                            initial={{ opacity: 0, y: -4, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -4, scale: 0.98 }}
                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                            className="absolute top-[calc(100%+8px)] left-0 w-64 z-50"
                        >
                            {/* 内容容器 */}
                            <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-xl border border-stone-100/50 overflow-hidden ring-1 ring-black/5">
                                <div className="px-4 py-3 border-b border-stone-50 flex items-center justify-between">
                                    <span className="text-[10px] font-black text-stone-400 uppercase tracking-wider">最近项目</span>
                                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">{recentHistory.length}</span>
                                </div>
                                
                                <div className="max-h-[320px] overflow-y-auto py-1.5 scrollbar-thin scrollbar-thumb-stone-200 scrollbar-track-transparent">
                                    {recentHistory.length === 0 ? (
                                        <div className="px-4 py-6 text-xs text-stone-400 text-center flex flex-col items-center gap-2">
                                            <div className="w-8 h-8 bg-stone-50 rounded-full flex items-center justify-center">
                                                <Clock className="w-4 h-4 text-stone-300" />
                                            </div>
                                            <span>暂无历史记录</span>
                                        </div>
                                    ) : (
                                        recentHistory.map(item => {
                                            const isActive = item.id === currentHistoryId;
                                            return (
                                                <button
                                                    key={item.id}
                                                    onClick={() => handleSwitchProject(item)}
                                                    className={`w-full flex items-center gap-3 px-3 py-2.5 mx-1 rounded-xl transition-all text-left group max-w-[calc(100%-8px)] ${
                                                        isActive ? 'bg-emerald-50/60' : 'hover:bg-stone-50/80'
                                                    }`}
                                                >
                                                    <div className={`w-10 h-10 rounded-lg border overflow-hidden flex-shrink-0 transition-colors ${
                                                        isActive ? 'border-emerald-200' : 'bg-stone-50 border-stone-100 group-hover:border-stone-200'
                                                    }`}>
                                                        {item.thumbnail ? (
                                                            <img src={item.thumbnail} alt="缩略图" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center text-stone-300">
                                                                <Clock className="w-4 h-4" />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className={`text-xs font-bold truncate mb-0.5 ${isActive ? 'text-emerald-700' : 'text-stone-700 group-hover:text-stone-900'}`}>
                                                            {item.title || (item.problem_type ? TYPE_MAP[item.problem_type] : null) || '未命名课件'}
                                                        </div>
                                                        <div className="text-[10px] text-stone-400 font-medium flex items-center gap-1">
                                                            <span>{new Date(item.created_at).toLocaleDateString()}</span>
                                                            <span className="w-0.5 h-0.5 rounded-full bg-stone-300"></span>
                                                            <span>{new Date(item.created_at).getHours()}:{String(new Date(item.created_at).getMinutes()).padStart(2, '0')}</span>
                                                        </div>
                                                    </div>
                                                    {isActive && (
                                                        <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                                                            <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" />
                                                        </div>
                                                    )}
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                                
                                {/* 底部快捷操作 */}
                                <div className="px-2 py-2 border-t border-stone-50 bg-stone-50/30">
                                    <button 
                                        onClick={() => {
                                            setIsProjectMenuOpen(false);
                                            router.push('/dashboard?action=new');
                                        }}
                                        className="w-full py-2 rounded-lg border border-dashed border-stone-200 text-xs font-bold text-stone-500 hover:text-emerald-600 hover:border-emerald-300 hover:bg-white transition-all flex items-center justify-center gap-1.5"
                                    >
                                        <PenTool className="w-3 h-3" /> 新建项目
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    )}
                 </AnimatePresence>
             </div>
          </header>
        )}

        {/* Canvas Content */}
        <div className="w-full h-full relative flex flex-col items-center justify-center p-6 gap-6">
          
          {/* Dot Grid Background */}
          <div className="absolute inset-0 opacity-[0.25] pointer-events-none z-0" 
               style={{ backgroundImage: "radial-gradient(#a8a29e 2px, transparent 2px)", backgroundSize: "32px 32px" }}>
          </div>

          {/* Top: Upload Card (Always Visible) */}
          <div 
             className={`relative z-10 w-full max-w-4xl bg-white rounded-3xl shadow-sm border border-stone-200 p-6 flex flex-col gap-4 transition-all duration-300 ${isDragOver ? 'border-emerald-400 bg-emerald-50/10' : ''}`}
             onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
             onDragLeave={() => setIsDragOver(false)}
             onDrop={(e) => { setIsDragOver(false); handleDrop(e); }}
          >
             {/* Top Row: Title or Loading Progress */}
             <div className="w-full flex items-center justify-between min-h-[28px]">
                 {isLoading ? (
                     <div className="w-full">
                          <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-bold text-stone-600 animate-pulse truncate max-w-[240px]">{loadingText}</span>
                              {problemType && (
                                   <span className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 animate-in fade-in zoom-in duration-300">
                                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
                                      题型识别：{TYPE_MAP[problemType] || problemType}
                                   </span>
                               )}
                          </div>
                          <div className="h-1.5 w-full bg-stone-100 rounded-full overflow-hidden">
                              <div 
                                  className="h-full bg-emerald-500 transition-all duration-500 ease-out rounded-full"
                                  style={{ width: `${progress}%` }}
                              ></div>
                          </div>
                     </div>
                 ) : (
                     <div className="flex items-center justify-between w-full">
                       <h3 className="font-bold text-stone-700 text-sm tracking-wide">
                           {previewUrl ? "📸 题目图片已就绪" : "📤 上传题目图片或在此输入补充数学题目信息"}
                       </h3>
                       {problemType && (
                         <div className="flex items-center gap-1.5">
                           <span className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                             题型识别：{TYPE_MAP[problemType] || problemType}
                           </span>
                         </div>
                       )}
                     </div>
                 )}
             </div>

             {/* Bottom Row: Three-Column Workspace Layout */}
             <div className="flex items-center gap-4 w-full h-24">
                 {/* 1. Upload Dropzone */}
                 <div 
                     className="relative group w-44 h-full bg-stone-50/50 rounded-2xl border border-dashed border-stone-200 flex items-center justify-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-50/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 overflow-hidden"
                     onClick={() => fileInputRef.current?.click()}
                 >
                     {previewUrl ? (
                         <>
                             <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                             <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white gap-1">
                                 <PenTool className="w-4 h-4" />
                                 <span className="text-[10px] font-bold">更换图片</span>
                             </div>
                         </>
                     ) : (
                         <div className="flex flex-col items-center justify-center gap-1.5 text-stone-400 group-hover:text-emerald-500 transition-colors">
                             <CloudUpload className="w-6 h-6" />
                             <span className="text-[10px] font-bold">点击上传图片</span>
                         </div>
                     )}
                 </div>
                 
                 {/* 2. Text Input */}
                 <div className="flex-1 h-full relative">
                     <textarea
                         value={problemText}
                         onChange={(e) => setProblemText(e.target.value)}
                         onKeyDown={handleTextareaKeyDown}
                         disabled={isLoading}
                         placeholder="在此输入数学题目的文本、解题提示或描述，按 Ctrl+Enter 快速生成..."
                         className="w-full h-full bg-stone-50/20 border border-stone-200 rounded-2xl px-3 py-2.5 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 transition-all duration-300 resize-none shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                     />
                 </div>

                 {/* 3. Action Buttons & Credit Info */}
                 <div className="w-44 h-full flex flex-col justify-center items-center gap-1.5">
                     {isLoading ? (
                         <div className="w-full flex flex-col items-center">
                             <button 
                                 disabled
                                 className="w-full h-11 bg-stone-100 text-stone-400 font-bold rounded-full flex items-center justify-center gap-2 cursor-not-allowed"
                             >
                                 <Loader2 className="w-4 h-4 animate-spin" />
                                 生成中...
                             </button>
                         </div>
                     ) : isGenerated ? (
                          <div className="w-full flex flex-col items-center gap-1">
                              <button 
                                  onClick={handleRegenerate}
                                  className="w-full h-11 bg-white border border-stone-200 text-stone-700 font-bold rounded-full shadow-sm hover:border-emerald-500 hover:text-emerald-600 hover:shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 group"
                              >
                                  <RefreshCw className="w-4 h-4 text-emerald-500 group-hover:rotate-180 transition-transform duration-500" />
                                  重新生成
                              </button>
                              <span className="text-[10px] text-stone-400 font-bold tracking-wide">
                                  <span></span>
                              </span>
                          </div>
                     ) : (previewUrl || problemText.trim()) ? (
                          <div className="w-full flex flex-col items-center gap-1">
                              <button 
                                  onClick={handleGenerate}
                                  className="w-full h-11 bg-emerald-500 text-white font-bold rounded-full shadow-md hover:bg-emerald-600 hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 group"
                              >
                                  <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                                  生成课件
                              </button>
                              <span className="text-[10px] text-stone-400 font-bold tracking-wide">
                                  <span></span>
                              </span>
                          </div>
                     ) : (
                          <div className="w-full h-11 border border-dashed border-stone-200 rounded-full flex items-center justify-center text-xs font-bold text-stone-300 select-none">
                              等待输入内容
                          </div> 
                     )}
                 </div>
              </div>

              <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={(e) => e.target.files && handleFileSelect(e.target.files[0])}
              />
           </div>

          {/* Bottom: GeoGebra Card (Fixed Aspect Ratio) */}
          <div 
             className={
               isFullscreen 
                 ? 'ggb-fullscreen-wrapper' 
                 : `relative ${!isGenerated ? 'opacity-100 grayscale pointer-events-none' : ''} bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden inline-block`
             }
          >
              <style jsx global>{`
                 #ggb-element, #ggb-element > div { 
                    border: none !important; 
                    outline: none !important; 
                    box-shadow: none !important; 
                 }
                 
                 .ggb-fullscreen-wrapper { 
                   position: fixed !important; 
                   inset: 0 !important; 
                   z-index: 9999 !important; 
                   background-color: white !important; 
                   display: flex !important; 
                   align-items: center !important; 
                   justify-content: center !important; 
                   overflow: hidden !important; 
                 }
                 
                 .ggb-fullscreen-wrapper .ggb-scaled-content { 
                   width: 900px !important; 
                   height: 600px !important; 
                   transform: scale(var(--ggb-scale, 1)); 
                   transform-origin: center center; 
                   flex-shrink: 0; 
                   box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                   border-radius: 16px;
                   overflow: hidden;
                   background: white;
                 }
              `}</style>
              
              {!isGenerated && !isFullscreen && (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-stone-50/20 backdrop-blur-[2px] rounded-2xl">
                      <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mb-4">
                          <LayoutGrid className="w-8 h-8 text-stone-300" />
                      </div>
                      <p className="text-stone-400 font-bold">画板准备就绪</p>
                  </div>
              )}

              {/* Fullscreen Controls */}
              {!isFullscreen ? (
                  <button 
                      onClick={() => toggleFullscreen(true)}
                      className="absolute top-4 right-4 z-10 p-2 bg-white/80 backdrop-blur-sm rounded-lg hover:bg-white text-stone-400 hover:text-stone-600 shadow-sm hover:shadow transition-all"
                      title="全屏查看"
                  >
                      <Maximize2 className="w-5 h-5" />
                  </button>
              ) : (
                  <button 
                      onClick={() => toggleFullscreen(false)}
                      className="absolute top-6 right-6 z-[10000] p-3 bg-white rounded-full shadow-lg hover:shadow-xl hover:bg-stone-50 text-stone-600 transition-all"
                      title="退出全屏"
                  >
                      <X className="w-6 h-6 stroke-[3]" />
                  </button>
              )}

              {/* 卡片容器 */}
              <div className={isFullscreen ? 'ggb-scaled-content' : 'bg-white overflow-hidden'}>
                  <GeoGebraBoard onAppletReady={setGgbApplet} />
              </div>
          </div>
        </div>
      </main>

      {/* 3. Right Panel (Fixed) */}
      <aside className="w-80 bg-[#FDFCF8] border-l border-stone-200 flex flex-col z-30 flex-shrink-0 h-screen overflow-y-auto">
         <div className="p-5 border-b border-stone-100 flex items-center justify-between">
            <h3 className="font-black text-stone-800 text-sm uppercase tracking-wider">属性面板</h3>
            <button className="text-stone-300 hover:text-stone-500"><MoreHorizontal className="w-5 h-5"/></button>
         </div>

         <div className="p-5 space-y-6 flex-1 min-h-0 overflow-y-auto">
            {/* Reference Image */}
            {previewUrl && (
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-stone-400 uppercase tracking-wider">原始题目</label>
                   <div 
                      className="rounded-xl overflow-hidden border-2 border-stone-100 shadow-sm group relative cursor-pointer"
                      onClick={() => setIsPreviewImageOpen(true)}
                   >
                       <img src={previewUrl} className="w-full h-auto object-cover" alt="Reference" />
                       <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold pointer-events-none">
                          点击放大
                       </div>
                   </div>
                </div>
            )}

            {/* Parameters Control (New) */}
            {isGenerated && sliders.length > 0 && (
                <div className="space-y-2 animate-in slide-in-from-right-4 duration-500">
                   <label className="text-[10px] font-black text-stone-400 uppercase tracking-wider">参数控制</label>
                   <div className="bg-white rounded-xl border-2 border-stone-100 p-4 space-y-3 shadow-sm">
                       {sliders.map((slider) => (
                           <div key={slider.name} className="flex items-center justify-between gap-3">
                               <div className="flex items-center gap-2 min-w-[30px]">
                                   <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                   <span className="font-bold text-stone-600 font-mono text-sm">{slider.name}</span>
                               </div>
                               <div className="flex-1">
                                   <input 
                                       type="number" 
                                       step="0.01"
                                       value={
                                           typeof slider.value === 'number' 
                                              ? slider.value.toFixed(2) 
                                              : slider.value
                                       }
                                       onFocus={(e) => handleInputFocus(e, slider.name)}
                                       onBlur={() => handleInputBlur(slider.name)}
                                       onKeyDown={handleInputKeyDown}
                                       onChange={(e) => handleSliderChange(slider.name, e.target.value)}
                                       className="w-full px-3 py-1.5 bg-stone-50 border border-stone-200 rounded-lg text-sm font-mono text-stone-700 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all text-left [&::-webkit-inner-spin-button]:appearance-auto [&::-webkit-outer-spin-button]:appearance-auto"
                                   />
                               </div>
                           </div>
                       ))}
                   </div>
                </div>
            )}

            {/* GGB Command Library (New) */}
            {isGenerated && executedCommands.length > 0 && (
                <div className="space-y-2 pt-4 border-t border-stone-100 animate-in slide-in-from-right-4 duration-500 delay-100">
                   <div className="flex items-center justify-between">
                       <label className="text-[10px] font-black text-stone-400 uppercase tracking-wider">GGB 指令</label>
                       <div className="flex items-center gap-2">
                           <button 
                               onClick={() => setIsGgbCommandsExpanded(!isGgbCommandsExpanded)}
                               className="text-[10px] font-bold text-stone-500 hover:text-emerald-600 transition-all bg-stone-50 hover:bg-emerald-50 px-2 py-1 rounded-md"
                           >
                               {isGgbCommandsExpanded ? "收起" : "展开"}
                           </button>
                           <button 
                               onClick={handleCopyCommands}
                               className="flex items-center gap-1.5 text-[10px] font-bold text-stone-400 hover:text-emerald-600 transition-all bg-stone-50 hover:bg-emerald-50 px-2 py-1 rounded-md active:scale-95"
                           >
                               {isCopied ? (
                                   <>
                                       <Check className="w-3 h-3 stroke-[3]" />
                                       <span>已复制</span>
                                   </>
                               ) : (
                                   <>
                                       <Copy className="w-3 h-3 stroke-[2.5]" />
                                       <span>复制</span>
                                   </>
                               )}
                           </button>
                       </div>
                   </div>
                   
                   {isGgbCommandsExpanded ? (
                       <div className="bg-stone-50/50 rounded-xl border border-stone-100 p-3 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-stone-200 scrollbar-track-transparent shadow-inner animate-in fade-in duration-200">
                           <div className="font-mono text-[10px] leading-relaxed text-stone-600 break-all whitespace-pre-wrap select-all">
                               {executedCommands.join('\n')}
                           </div>
                       </div>
                   ) : (
                       <div className="bg-stone-50/30 rounded-xl border border-stone-100 px-3 py-2 text-[10px] text-stone-400 font-mono truncate">
                           {executedCommands[0]}... (共 {executedCommands.length} 条指令)
                       </div>
                   )}
                </div>
            )}

         </div>

         {/* 底部固定：导出项目 */}
         {isGenerated && (
           <div className="p-5 border-t border-stone-100 flex-shrink-0">
             <div className="relative">
               <button 
                  onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full text-sm font-bold shadow-md hover:shadow-lg hover:-translate-y-[1px] transition-all"
               >
                  <FileDown className="w-4 h-4 stroke-[2.5]" /> 导出项目
               </button>
               {isExportMenuOpen && (
                 <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl shadow-xl border border-stone-100 overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
                     <button onClick={() => handleExport('html')} className="w-full text-left px-4 py-3 hover:bg-stone-50 text-stone-700 font-bold text-sm flex items-center gap-2 border-b border-stone-50">
                         <span className="bg-orange-100 text-orange-600 text-[10px] px-1.5 py-0.5 rounded font-black">HTML</span> 交互网页
                     </button>
                     <button onClick={() => handleExport('ggb')} className="w-full text-left px-4 py-3 hover:bg-stone-50 text-stone-700 font-bold text-sm flex items-center gap-2">
                         <span className="bg-blue-100 text-blue-600 text-[10px] px-1.5 py-0.5 rounded font-black">GGB</span> GeoGebra 文件
                     </button>
                 </div>
               )}
             </div>
           </div>
         )}
      </aside>

      {/* Image Preview Modal (Lightbox) */}
      {isPreviewImageOpen && previewUrl && (
        <div 
            className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200"
            onClick={() => setIsPreviewImageOpen(false)}
        >
            <div className="relative max-w-[90vw] max-h-[90vh] animate-in zoom-in-95 duration-200">
                <button 
                    onClick={() => setIsPreviewImageOpen(false)}
                    className="absolute -top-12 right-0 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors"
                >
                    <X className="w-6 h-6" />
                </button>
                <img 
                    src={previewUrl} 
                    alt="Original Problem" 
                    className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                    onClick={(e) => e.stopPropagation()} 
                />
            </div>
        </div>
      )}

    </div>
  );
}
