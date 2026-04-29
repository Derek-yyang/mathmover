'use client';

export const dynamic = 'force-dynamic';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link'; 
import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
import { supabase } from '../../lib/supabase';

// 类型定义
interface GeoGebraApi {
  newConstruction: () => void;
  setPerspective: (p: string) => void;
  setAxesVisible: (x: boolean, y: boolean, z?: boolean) => void;
  setGridVisible: (v: boolean) => void;
  evalCommand: (cmd: string) => void;
  getValue: (name: string) => number;
  setValue: (name: string, val: number) => void;
  registerUpdateListener: (fn: (name: string) => void) => void;
  unregisterUpdateListener: (fn: (name: string) => void) => void;
  getBase64: (cb: (b64: string) => void) => void;
  refreshViews: () => void;
  recalcDisplay?: () => void;
  getAllObjectNames: () => string[];
  getObjectType: (name: string) => string;
  isIndependent: (name: string) => boolean;
}

interface GenerationRecord {
  id: string;
  user_id: string;
  title: string | null;
  problem_type: string | null;
  image_url: string | null;
  ggb_commands: string;
  created_at: string;
}

interface UserProfile {
  id: string;
  monthly_credits: number;
  permanent_credits: number;
  use_custom_model: boolean;
  custom_model_name?: string;
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-[#FDFCF8] text-stone-500">正在加载工作台...</div>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
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
  const [isFullscreen, setIsFullscreen] = useState(false); 
  const [isPreviewImageOpen, setIsPreviewImageOpen] = useState(false); 
  const [sliders, setSliders] = useState<{name: string, value: number | string, min: number, max: number}[]>([]); 
  const [activeSliderName, setActiveSliderName] = useState<string | null>(null); 
  const [problemText, setProblemText] = useState(''); 
  const [user, setUser] = useState<{ id: string } | null>(null); 
  const [credits, setCredits] = useState<number>(0); 
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  const [isRedeemModalOpen, setIsRedeemModalOpen] = useState(false); 
  const [redeemCode, setRedeemCode] = useState(''); 
  const [isRedeeming, setIsRedeeming] = useState(false); 
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | null }>({ message: '', type: null });

  const [pendingCommands, setPendingCommands] = useState<string[]>([]);
  const [executedCommands, setExecutedCommands] = useState<string[]>([]);
  const [isCopied, setIsCopied] = useState(false);
  const [lastUploadedFile, setLastUploadedFile] = useState<File | null>(null);
  const [lastUploadedUrl, setLastUploadedUrl] = useState<string | null>(null);

  // 显示 Toast 提示
  const showToast = (message: string, type: 'success' | 'error') => {
      setToast({ message, type });
      setTimeout(() => setToast({ message: '', type: null }), 3000);
  };
  
  // 历史项目切换相关
  const [recentHistory, setRecentHistory] = useState<GenerationRecord[]>([]);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
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
  
  // 题目类型映射
  const TYPE_MAP: Record<string, string> = { 
      'A': '函数与图像', 
      'B': '平面几何', 
      'C': '解析几何', 
      'D': '立体几何' 
  };
  
  // 监听用户登录状态
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      // 【诊断 3】Dashboard 读到的 Session
      console.log("【诊断 3】Dashboard 读到的 Session:", session);

      if (!session) {
        // window.location.replace('/login');
      } else {
        setUser(session.user);
        fetchCredits(session.user.id);
        fetchRecentHistory(session.user.id);
      }
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        // window.location.replace('/login');
      } else if (session) {
         setUser(session.user);
         fetchRecentHistory(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // 监听 URL 参数变化 (响应 Sidebar 操作)
  useEffect(() => {
      const action = searchParams.get('action');
      const historyId = searchParams.get('history_id');

      // 1. 处理兑换 (已改为跳转到个人中心，此处仅保留逻辑兼容或移除)
      // 如果 action === 'redeem'，重定向到 profile
      if (action === 'redeem') {
          router.push('/dashboard/profile?tab=credits');
          return;
      } 
      
      // 2. 处理新建 (由 Sidebar 触发)
      if (action === 'new') {
          setFile(null);
          setPreviewUrl(null);
          setIsGenerated(false);
          setProblemText('');
          setProblemType(null);
          setProgress(0);
          setCurrentProjectTitle("未命名课件");
          setLastUploadedFile(null); // 重置缓存
          setLastUploadedUrl(null);
          setActiveProjectId(null); // 重置当前项目 ID
          setSavedImageUrl(null);
          if (ggbApplet) ggbApplet.newConstruction();
          // 清理 URL，防止刷新后仍然重置
          router.replace('/dashboard');
      }

      if (historyId) {
          setActiveProjectId(historyId);
          fetchHistoryItem(historyId);
      }
  }, [searchParams]);

  const fetchRecentHistory = async (userId: string) => {
    const { data } = await supabase
      .from('generations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);
    setRecentHistory(data || []);
  };

  const fetchHistoryItem = async (id: string) => {
      const { data, error } = await supabase
          .from('generations')
          .select('*')
          .eq('id', id)
          .single();
      
      if (data) {
          loadHistoryItem(data);
      }
  };

  // 获取积分 (用于生成前检查)
  const fetchCredits = async (userId: string) => {
      // 先执行积分同步（处理每日赠送逻辑）
      await supabase.rpc('sync_user_credits', { user_uuid: userId });

      const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();
      
      if (error) console.error('Error fetching credits:', error);
      else {
          // 计算总积分：月度赠送 + 永久积分
          const total = (data?.monthly_credits || 0) + (data?.permanent_credits || 0);
          setCredits(total);
          setUserProfile(data);
      }
  };

  // 加载历史记录项
  const loadHistoryItem = (item: GenerationRecord) => {
      // 1. 恢复图片预览
      if (item.image_url) {
          setPreviewUrl(item.image_url);
          setSavedImageUrl(item.image_url);
      } else {
          setPreviewUrl(null);
          setSavedImageUrl(null);
      }
      
      // 2. 恢复题型
      setProblemType(item.problem_type || null);

      // 3. 更新标题
      setCurrentProjectTitle(item.title || (item.problem_type ? TYPE_MAP[item.problem_type] : null) || '未命名课件');
      
      // 4. 恢复指令
      try {
          const commands = JSON.parse(item.ggb_commands);
          if (Array.isArray(commands)) {
              console.log('Restoring commands from history:', commands.length);
              setPendingCommands(commands); 
              setExecutedCommands(commands);
              setIsGenerated(true); 
          }
      } catch (e) {
          console.error('Failed to parse history commands:', e);
      }
  };

  const handleSwitchProject = (item: GenerationRecord) => {
      setIsProjectMenuOpen(false);
      // 使用 router.push 触发 URL 变化，从而触发 useEffect -> fetchHistoryItem -> loadHistoryItem
      // 这样保持了逻辑的一致性，且 URL 与内容同步
      router.push(`/dashboard?history_id=${item.id}`);
  };

  // 兑换积分
  const handleRedeem = async () => {
      if (!redeemCode || redeemCode.length < 5) {
          showToast('请输入有效的兑换码', 'error');
          return;
      }

      if (!user) {
          showToast('请先登录', 'error');
          return;
      }

      setIsRedeeming(true);

      try {
          const { data, error } = await supabase.rpc('redeem_code', {
              code_input: redeemCode,
              user_uuid: user.id
          });
          
          console.log("RPC 返回结果:", { data, error });
          
          if (error) {
              showToast(`❌ ${error.message}`, 'error');
              return;
          }

          // 兼容处理：RPC 返回 table 时 data 可能是数组
          const result = Array.isArray(data) ? data[0] : data;
          
          if (result && result.success) {
              showToast(`🎉 兑换成功！获得 ${result.points} 积分`, 'success');
              setCredits(prev => prev + result.points);
              setIsRedeemModalOpen(false);
              setRedeemCode('');
          } else {
              const msg = result?.message || '兑换失败，未知错误';
              showToast(`❌ ${msg}`, 'error');
          }
      } catch (err: unknown) {
          console.error('Redeem failed:', err);
          showToast('兑换失败：' + ((err as Error).message || '未知错误'), 'error');
      } finally {
          setIsRedeeming(false);
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
        console.log('GeoGebra 就绪，开始执行待处理指令:', pendingCommands.length);
        
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
                ggbApplet.evalCommand('setPerspective("G")');
                ggbApplet.evalCommand('ShowAxes(true)');
                ggbApplet.evalCommand('ShowGrid(true)');
            } else {
                ggbApplet.setPerspective("T"); 
                ggbApplet.setAxesVisible(true, true, true);
                ggbApplet.setGridVisible(true);
            }
    
            setTimeout(() => {
                commandsToRun.forEach((cmd) => {
                     try {
                         const cleanCmd = cmd.replace(/\\"/g, '"'); 
                         ggbApplet.evalCommand(cleanCmd);
                     } catch (err) {
                         console.error('❌ 执行失败:', cmd, err);
                     }
                });
                
                ggbApplet.evalCommand('SetFontSize(10)');
    
                if (currentMode === '2D') {
                    ggbApplet.evalCommand('CenterView((0,0))');
                    ggbApplet.evalCommand('ZoomIn(-10)'); 
                }
        
                ggbApplet.refreshViews();
                
                if (ggbApplet.recalcDisplay) {
                    ggbApplet.recalcDisplay();
                }
        
                setPendingCommands([]);
                
                setTimeout(() => detectSliders(ggbApplet), 500);
            }, 300); 
        }, 50);
    }
  }, [ggbApplet, pendingCommands]);

  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile || !selectedFile.type.startsWith('image/')) {
      showToast('请上传有效的图片文件 (JPG, PNG).', 'error');
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
    // 提取路径的工具函数 (Path Extractor)
    const extractFilePath = (url: string) => {
        try {
            const parts = url.split('/problem-images/');
            if (parts.length > 1) {
                // 移除可能存在的 URL 参数 (如 ?t=123)
                const pathWithPossibleParams = parts[1];
                return pathWithPossibleParams.split('?')[0];
            }
            return null;
        } catch (e) {
            console.error("Error extracting file path:", e);
            return null;
        }
    };

    let oldImageUrlToDelete: string | null = null;
    
    // 记录旧图片链接 (Capture Old Image)
    // 如果 activeProjectId 存在，且 savedImageUrl 有值，且当前正在上传新文件 (file 存在)
    if (activeProjectId && savedImageUrl && file) {
         oldImageUrlToDelete = savedImageUrl;
    }

    // 允许无文件生成：只要有 file、previewUrl 或者 problemText 即可继续
    if (!file && !previewUrl && !problemText.trim()) return;
    
    // 前端积分预检查 (Credit Pre-check)
    // 只有在非 BYOK 模式下才检查积分余额
    if (user && !userProfile?.use_custom_model && credits <= 0) {
        showToast('积分不足，请充值', 'error');
        return; // 直接返回，不触发任何加载状态
    }

    setIsLoading(true);
    setIsGenerated(false);
    setProgress(0); 
    setLoadingText("正在识别题目图像信息..."); 
    setProblemType(null);
    
    if (ggbApplet) {
      ggbApplet.newConstruction();
    }

    let imageUrl = '';
    // 如果有新文件，先处理上传逻辑
    if (file && user) {
        try {
            // 检查是否可以使用缓存
            if (lastUploadedUrl && lastUploadedFile && file === lastUploadedFile) {
                console.log('Skipping upload, using cached URL:', lastUploadedUrl);
                imageUrl = lastUploadedUrl;
            } else {
                const fileExt = file.name.split('.').pop();
                const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
                const filePath = `${user.id}/${fileName}`;

                const { error: uploadError } = await supabase.storage
                    .from('problem-images')
                    .upload(filePath, file);

                if (uploadError) {
                    console.error('Supabase upload error:', uploadError);
                } else {
                    const { data } = supabase.storage
                        .from('problem-images')
                        .getPublicUrl(filePath);
                    imageUrl = data.publicUrl;
                    
                    // 更新缓存
                    setLastUploadedFile(file);
                    setLastUploadedUrl(imageUrl);
                }
            }
        } catch (err) {
            console.error('Image upload failed:', err);
        }
    } else if (!file && previewUrl) {
        // 如果没有新文件，但有预览图（历史记录），直接使用 previewUrl
        imageUrl = previewUrl;
    }

    const formData = new FormData();
    if (file) {
        formData.append('file', file);
    } else if (imageUrl) {
        formData.append('imageUrl', imageUrl);
    }

    if (problemText) {
        formData.append('text', problemText);
    }
    if (user) {
        formData.append('user_id', user.id);
    }

    try {
      // 修复漏洞 1：获取当前 session token 用于后端鉴权
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server Error (${response.status}): ${errorText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
                  
                  if (data.error) {
                      throw new Error(data.error);
                  }

                  if (data.status === 'classified') {
                      setProblemType(data.category);
                      setLoadingText("正在调用专家模型生成指令...");
                  } else if (data.status === 'completed') {
                      
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

                      const saveToSupabase = async () => {
                          try {
                              const { data: { user } } = await supabase.auth.getUser();
                              if (user) {
                                  let error = null;

                                  if (activeProjectId) {
                                      // Update existing
                                      console.log('Updating existing project:', activeProjectId);
                                      const result = await supabase
                                          .from('generations')
                                          .update({
                                              ggb_commands: JSON.stringify(validCommands), 
                                              problem_type: data.category,
                                              image_url: imageUrl || null 
                                          })
                                          .eq('id', activeProjectId);
                                      error = result.error;
                                  } else {
                                      // Insert new
                                      console.log('Inserting new project...');
                                      const result = await supabase
                                          .from('generations')
                                          .insert({
                                              user_id: user.id,
                                              ggb_commands: JSON.stringify(validCommands), 
                                              problem_type: data.category,
                                              image_url: imageUrl || null 
                                          })
                                          .select()
                                          .single();
                                      
                                      error = result.error;
                                      if (result.data) {
                                          setActiveProjectId(result.data.id);
                                      }
                                  }
                                  
                                  if (error) {
                                      console.error('Error saving to Supabase:', error);
                                  } else {
                                      // 成功保存后，更新本地缓存的 savedImageUrl
                                      if (imageUrl) {
                                          setSavedImageUrl(imageUrl);
                                      }

                                      // 安全清理旧图片 (Safe Cleanup)
                                      if (oldImageUrlToDelete && oldImageUrlToDelete !== imageUrl) {
                                          const pathToDelete = extractFilePath(oldImageUrlToDelete);
                                          if (pathToDelete) {
                                              const { error: deleteError } = await supabase.storage.from('problem-images').remove([pathToDelete]);
                                              if (deleteError) console.error("清理旧图片失败:", deleteError);
                                              else console.log("✅ 成功清理旧图片:", pathToDelete);
                                          }
                                      }

                                      // 只有当 data.deduct_credits !== false 时才扣除积分
                                      if (data.deduct_credits !== false) {
                                          // 修复漏洞 2：后端已完成扣费，前端仅需更新本地状态
                                          setCredits(prev => prev - 1); 
                                      } else {
                                          console.log('Using custom model, skipping credit deduction.');
                                      }
                                  }
                              }
                          } catch (err) {
                              console.error('Failed to save history:', err);
                          }
                      };
                      saveToSupabase();
                      
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
              }
          }
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
                                                        {item.image_url ? (
                                                            <img src={item.image_url} alt="缩略图" className="w-full h-full object-cover" />
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
             className={`relative z-10 w-full max-w-4xl bg-white rounded-2xl shadow-sm border border-stone-100 p-6 flex items-center justify-between transition-all duration-300 ${isDragOver ? 'border-emerald-400 bg-emerald-50/30' : ''}`}
             onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
             onDragLeave={() => setIsDragOver(false)}
             onDrop={(e) => { setIsDragOver(false); handleDrop(e); }}
          >
             {/* Left: Action Area */}
             <div className="flex items-center gap-6 flex-1">
                <div 
                    className="relative group w-40 h-24 flex-shrink-0 bg-stone-50 rounded-lg border-2 border-dashed border-stone-200 flex items-center justify-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-50/50 transition-all overflow-hidden"
                    onClick={() => fileInputRef.current?.click()}
                >
                    {previewUrl ? (
                        <>
                            <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white gap-1">
                                <PenTool className="w-5 h-5" />
                                <span className="text-xs font-bold">更换图片</span>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-2 text-stone-300 group-hover:text-emerald-500 transition-colors">
                            <CloudUpload className="w-8 h-8" />
                            <span className="text-xs font-bold">点击上传</span>
                        </div>
                    )}
                </div>
                
             {/* Right: Action Area (Text & Button) */}
             <div className="flex flex-col justify-between h-full flex-1 gap-4">
                
                {/* Title or Progress Area */}
                <div className="min-h-[28px] flex items-center">
                    {isLoading ? (
                            <div className="w-[60%]">
                                 <div className="flex items-center justify-between mb-1.5">
                                     <span className="text-sm font-bold text-stone-600 animate-pulse whitespace-nowrap overflow-hidden text-ellipsis max-w-[200px]">{loadingText}</span>
                                     {problemType && (
                                          <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 animate-in fade-in zoom-in duration-300 whitespace-nowrap ml-2">
                                             <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
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
                        <h3 className="font-bold text-stone-700 text-lg">
                            {previewUrl ? "图片已就绪" : "上传题目图片"}
                        </h3>
                    )}
                </div>

                {/* Content Container: Textarea + Button */}
                <div className="flex items-end gap-4 w-full">
                    
                    {/* Text Input (Flex-1) */}
                    <div className="flex-1 min-w-0 relative group">
                        <textarea
                            value={problemText}
                            onChange={(e) => setProblemText(e.target.value)}
                            disabled={isLoading}
                            placeholder="在此输入题目内容或补充信息……"
                            className="w-full max-w-[400px] bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300 resize-none h-10 focus:h-32 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                    </div>

                    {/* Dynamic Action Area (Flex-Shrink-0) */}
                    <div className="flex-shrink-0 w-[160px] h-[52px] flex flex-col justify-end items-center gap-1.5">
                        {isLoading ? (
                            <div className="w-full flex flex-col items-center">
                                {userProfile?.use_custom_model && (
                                    <span className="text-[10px] font-bold text-zinc-500 mb-1 animate-in fade-in slide-in-from-bottom-1 duration-500 whitespace-nowrap">
                                        使用模型：{userProfile.custom_model_name || 'Custom Model'}
                                    </span>
                                )}
                                <button 
                                    disabled
                                    className="w-full h-[42px] bg-stone-100 text-stone-400 font-bold rounded-xl shadow-none flex items-center justify-center gap-2 cursor-not-allowed"
                                >
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    生成中...
                                </button>
                            </div>
                        ) : isGenerated ? (
                             <div className="w-full flex flex-col items-center">
                                 <button 
                                     onClick={handleRegenerate}
                                     className="w-full h-[42px] bg-white border-2 border-stone-200 text-stone-600 font-bold rounded-xl shadow-sm hover:border-emerald-400 hover:text-emerald-600 hover:shadow-md hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
                                 >
                                     <RefreshCw className="w-5 h-5 stroke-[2.5]" />
                                     重新生成
                                 </button>
                                 <span className="text-[10px] text-zinc-400 font-medium">
                                     {userProfile?.use_custom_model ? "🛡️ 不消耗平台积分" : "✨ 消耗 1 积分"}
                                 </span>
                             </div>
                        ) : (previewUrl || problemText.trim()) ? (
                             <div className="w-full flex flex-col items-center">
                                 <button 
                                     onClick={handleGenerate}
                                     className="w-full h-[42px] bg-emerald-500 text-white font-bold rounded-xl shadow-lg hover:bg-emerald-600 hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
                                 >
                                     <RefreshCw className="w-5 h-5 stroke-[3]" />
                                     生成演示
                                 </button>
                                 <span className="text-[10px] text-zinc-400 font-medium">
                                     {userProfile?.use_custom_model ? "🛡️ 不消耗平台积分" : "✨ 消耗 1 积分"}
                                 </span>
                             </div>
                        ) : (
                             <div className="w-full h-[42px]"></div> 
                        )}
                    </div>
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

         <div className="p-5 space-y-6">
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
                   
                   <div className="bg-stone-50/50 rounded-xl border border-stone-100 p-3 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-stone-200 scrollbar-track-transparent shadow-inner">
                       <div className="font-mono text-[10px] leading-relaxed text-stone-600 break-all whitespace-pre-wrap select-all">
                           {executedCommands.join('\n')}
                       </div>
                   </div>
                </div>
            )}

            {/* Actions */}
            {isGenerated && (
                <div className="space-y-2 pt-4 border-t border-stone-100">
                   <label className="text-[10px] font-black text-stone-400 uppercase tracking-wider">快捷操作</label>
                   <div className="grid grid-cols-1 gap-3">
                      
                      <div className="relative">
                          <button 
                             onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                             className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg hover:translate-y-[-1px] transition-all"
                          >
                             <FileDown className="w-4 h-4 stroke-[2.5]" /> 导出项目
                          </button>
                          
                          {isExportMenuOpen && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-stone-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
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
                </div>
            )}
         </div>
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

      {/* Redeem Modal */}
      {isRedeemModalOpen && (
          <div 
              className="fixed inset-0 z-[10000] bg-black/50 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200"
              onClick={() => setIsRedeemModalOpen(false)}
          >
              <div 
                  className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 border border-stone-100"
                  onClick={(e) => e.stopPropagation()}
              >
                  <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-black text-stone-700">兑换积分</h3>
                      <button 
                          onClick={() => setIsRedeemModalOpen(false)}
                          className="p-1 hover:bg-stone-100 rounded-full text-stone-400 hover:text-stone-600 transition-colors"
                      >
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  
                  <div className="space-y-4">
                      <div className="space-y-2">
                          <label className="text-xs font-bold text-stone-400 uppercase tracking-wider pl-1">卡密兑换码</label>
                          <input 
                              type="text" 
                              value={redeemCode}
                              onChange={(e) => setRedeemCode(e.target.value.trim())}
                              placeholder="请输入 12 位兑换码"
                              className="w-full px-4 py-3 bg-stone-50 border-2 border-stone-100 rounded-xl text-base font-bold text-stone-700 placeholder:text-stone-300 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all font-mono"
                          />
                      </div>
                      
                      <button 
                          onClick={handleRedeem}
                          disabled={isRedeeming || !redeemCode}
                          className="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-emerald-200 hover:bg-emerald-600 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 disabled:bg-stone-200 disabled:shadow-none disabled:text-stone-400 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                      >
                          {isRedeeming ? <Loader2 className="w-4 h-4 animate-spin" /> : "立即兑换"}
                      </button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}
