'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Settings,
  CloudUpload,
  FileDown,
  RefreshCw,
  MoreHorizontal,
  Folder,
  LayoutGrid,
  ChevronDown,
  Clock,
  PenTool,
  Loader2,
  Maximize2,
  X
} from "lucide-react";
import GeoGebraBoard from '../../components/GeoGebraBoard';

export default function Dashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("准备中...");
  const [isGenerated, setIsGenerated] = useState(false);
  const [ggbApplet, setGgbApplet] = useState<any>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [progress, setProgress] = useState(0); // 新增进度条状态
  const [problemType, setProblemType] = useState<string | null>(null); // 新增题目类型状态
  const [isFullscreen, setIsFullscreen] = useState(false); // 新增全屏状态
  const [isPreviewImageOpen, setIsPreviewImageOpen] = useState(false); // 图片预览状态
  const [sliders, setSliders] = useState<{name: string, value: number | string, min: number, max: number}[]>([]); // 动态滑块列表 (value 支持 string 以允许空值输入)
  const [activeSliderName, setActiveSliderName] = useState<string | null>(null); // 当前正在编辑的滑块名 (防抖用)
  const [problemText, setProblemText] = useState(''); // 新增：题目补充文本

  const [pendingCommands, setPendingCommands] = useState<string[]>([]);
  
  // 题目类型映射
  const TYPE_MAP: Record<string, string> = { 
      'A': '函数与图像', 
      'B': '平面几何', 
      'C': '解析几何', 
      'D': '立体几何' 
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

    // 文案数组
    const statusMessages = [
        "正在识别题目图像信息...",
        "AI 正处于推导几何约束关系...",
        "正在构建动点与参数逻辑...",
        "正在生成 GeoGebra 绘图指令...",
        "正在进行最终渲染检查..."
    ];

    if (isLoading) {
      // 只有当进度为 0 时才重置（避免每次 isLoading 变化都重置）
      // 实际上 handleRegenerate 已经设为 0 了，这里可以不做强校验，但为了稳健可以只在开始时执行
      
      // 1. 进度模拟 (非线性增长 - 均衡速度版)
      progressInterval = setInterval(() => {
        setProgress((prev) => {
             // 绝对防御：一旦进度超过 90，这个定时器就彻底失效，不许动任何东西
             if (prev >= 90) {
                 return prev;
             }
             
             // 增长公式：剩余进度的 1/100 (折中方案：原 1/80 -> 1/150 -> 1/100)
             const increment = (90 - prev) / 100; 
             // 最小增量 0.08
             return prev + (increment < 0.08 ? 0.08 : increment);
        });
      }, 100);

      // 2. 文案轮播 (每7秒切换)
      let i = 0;
      textInterval = setInterval(() => {
        i++;
        if (i < statusMessages.length) {
            setLoadingText(statusMessages[i]);
        } else {
            // 已到达最后一条文案，停止轮播，保持显示最后一条
            clearInterval(textInterval);
        }
      }, 7000);

    } 
    
    // 关键修复：当 isLoading 变为 false 时，立即清除定时器
    // 这能防止“完成动画”正在跑的时候，旧的“慢速增长定时器”还在后台捣乱修改数值
    return () => {
        if (progressInterval) clearInterval(progressInterval);
        if (textInterval) clearInterval(textInterval);
    };
  }, [isLoading]);

  // 核心逻辑 - 嗅探滑块
  const detectSliders = (api: any) => {
      if (!api) return;
      
      const allObjects = api.getAllObjectNames();
      const newSliders: {name: string, value: number | string, min: number, max: number}[] = [];
      
      allObjects.forEach((name: string) => {
          if (api.getObjectType(name) === 'numeric') {
              // 检查是否是滑块 (通过检查是否可见、是否定义了 min/max)
              // GeoGebra API 没有直接的 isSlider 方法，但通常滑块是独立的数值变量
              // 我们可以假设所有独立数值变量都是潜在的滑块，或者通过名称约定 (t, m, k, angle)
              
              // 简单的启发式：如果是自由对象且是数值，就认为是滑块
              // 或者更严格一点：只有当它有定义的 Slider 范围时
              
              // 注意：api.getValue(name) 返回数值
              // api.getSliderMin(name) / api.getSliderMax(name) 如果没定义滑块可能会返回默认值或报错
              // 我们尝试获取
              const val = api.getValue(name);
              // 过滤掉常量 (如 pi, e) 和辅助计算值 (长度、面积等)
              // 通常辅助计算值的标签模式不同，或者它们是因变量
              if (api.isIndependent(name)) {
                  // 获取滑块范围，如果未设置，默认可能是 -5 到 5 或其他
                  // 如果不是滑块，getSliderMin 好像会返回空或报错，需 try-catch
                  try {
                      // 只有显式定义了滑块范围的才算
                      // 或者是常用的变量名
                      newSliders.push({
                          name: name,
                          value: val,
                          min: -10, // 默认范围，后续优化
                          max: 10
                      });
                  } catch (e) {}
              }
          }
      });
      
      // 进一步精细化：使用 API 获取真实范围
      // 由于 GGB JS API 对 Slider 范围支持有限，我们这里做一个简单的后处理
      // 实际上，我们更推荐只抓取我们在 Prompt 里生成的那些变量 (t, m, k, a, b, alpha, beta)
      // 但为了通用性，我们保留所有独立数值
      
      // 优化：只显示前 5 个滑块，防止过多
      setSliders(newSliders.slice(0, 5));
  };

  // 双向绑定：监听 GGB 更新
  useEffect(() => {
      if (!ggbApplet || !isGenerated) return;

      const onUpdate = (objName: string) => {
          // 如果当前正在编辑这个滑块，则暂停同步，防止光标跳动或输入被覆盖
          if (objName === activeSliderName) return;

          // 检查更新的对象是否在我们的 sliders 列表中
          setSliders(prevSliders => {
              const index = prevSliders.findIndex(s => s.name === objName);
              if (index !== -1) {
                  const newVal = ggbApplet.getValue(objName);
                  const currentVal = prevSliders[index].value;
                  
                  // 类型安全检查：如果是数字则比较，如果是字符串则强制更新（因为字符串意味着正在编辑，但这里理论上会被 activeSliderName 拦截）
                  // 但为了保险，还是做一下比较
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

      // 注册监听器
      ggbApplet.registerUpdateListener(onUpdate);
      
      // 初始嗅探
      detectSliders(ggbApplet);

      return () => {
          // 清理监听器
          if (ggbApplet && ggbApplet.unregisterUpdateListener) {
              ggbApplet.unregisterUpdateListener(onUpdate);
          }
      };
  }, [ggbApplet, isGenerated, activeSliderName]); // 增加 activeSliderName 依赖，确保监听器能获取最新状态

  // React 控制 GGB
  const handleSliderChange = (name: string, inputVal: string) => {
      // 1. 优先更新 React UI 状态，允许输入空字符串或负号
      setSliders(prev => prev.map(s => s.name === name ? { ...s, value: inputVal } : s));

      // 2. 尝试解析为数字，如果是有效数字，则同步给 GeoGebra
      const numVal = parseFloat(inputVal);
      if (!isNaN(numVal) && inputVal !== '' && inputVal !== '-') {
           if (ggbApplet) {
               ggbApplet.setValue(name, numVal);
           }
      }
  };

  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>, name: string) => {
      setActiveSliderName(name); // 锁定当前滑块，暂停来自 GGB 的更新
      e.target.select(); // 自动全选
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
          e.currentTarget.blur();
      }
  };

  const handleInputBlur = (name: string) => {
      setActiveSliderName(null); // 解锁
      // 失去焦点时，强制用 GGB 的真实值刷新一下 UI，确保格式正确 (比如把 "1." 变成 "1.00")
      if (ggbApplet) {
          const realVal = ggbApplet.getValue(name);
          setSliders(prev => prev.map(s => s.name === name ? { ...s, value: realVal } : s));
      }
  };

  // 监听 GeoGebra 实例就绪并执行待处理指令
  useEffect(() => {
    if (ggbApplet && pendingCommands.length > 0) {
        console.log('GeoGebra 就绪，开始执行待处理指令:', pendingCommands.length);
        
        ggbApplet.newConstruction(); // 清空旧图
        
        // 延迟 50ms 确保引擎重置完毕，再开始执行新指令
        setTimeout(() => {
            // 检查模式并精准控制视图 (关键逻辑)
            const commandsToRun = [...pendingCommands];
            let currentMode = '2D'; // 默认为 2D
    
            // 全局搜索 MODE 指令 (不局限于第一行)
            const modeIndex = commandsToRun.findIndex(cmd => cmd.startsWith('MODE:'));
            
            if (modeIndex !== -1) {
                const modeCmd = commandsToRun[modeIndex];
                // 移除这一行，避免作为普通指令执行
                commandsToRun.splice(modeIndex, 1);
                
                if (modeCmd.includes('3D')) {
                    currentMode = '3D';
                } else if (modeCmd.includes('2D')) {
                    currentMode = '2D';
                }
            } else {
                // 如果没有显式 MODE 指令，可以尝试根据 problemType 推断 (作为兜底)
                if (problemType === 'D') {
                    currentMode = '3D';
                }
            }
    
            if (currentMode === '2D') {
                // 使用 evalCommand 执行脚本指令，更加稳健
                ggbApplet.evalCommand('setPerspective("G")');
                ggbApplet.evalCommand('ShowAxes(true)');
                ggbApplet.evalCommand('ShowGrid(true)');
            } else {
                // 3D 视图切换比较重，可能会重置画板，增加额外的延迟
                ggbApplet.setPerspective("T"); // 3D 视图
                ggbApplet.setAxesVisible(true, true, true);
                ggbApplet.setGridVisible(true);
            }
    
            // 延迟执行指令，等待视图切换完成 (特别是 3D 模式)
            setTimeout(() => {
                // 逐行执行
                commandsToRun.forEach((cmd) => {
                     try {
                         // 处理可能的转义引号 (后端返回的 JSON 可能会有 \" )
                         // 如果 cmd 包含转义的双引号 \"，GeoGebra 可能会报错，尝试还原
                         const cleanCmd = cmd.replace(/\\"/g, '"'); 
                         ggbApplet.evalCommand(cleanCmd);
                         console.log('✅ 执行成功:', cleanCmd);
                     } catch (err) {
                         console.error('❌ 执行失败:', cmd, err);
                     }
                });
                
                // 全局优化：调整字体大小
                ggbApplet.evalCommand('SetFontSize(10)');
    
                // 2D 模式下重置缩放，防止图形跑偏
                if (currentMode === '2D') {
                    ggbApplet.evalCommand('CenterView((0,0))');
                    ggbApplet.evalCommand('ZoomIn(-10)'); // 大幅拉远视角，增加呼吸感
                }
        
                // 强制视图刷新 (确保所有元素都被渲染)
                ggbApplet.refreshViews();
                
                // 强制布局校准 (修复重新生成后的布局偏移)
                if (ggbApplet.recalcDisplay) {
                    ggbApplet.recalcDisplay();
                }
        
                // 清空待处理指令，防止重复执行
                setPendingCommands([]);
                
                // 绘图完成后，立即嗅探滑块
                setTimeout(() => detectSliders(ggbApplet), 500);
            }, 300); // 增加到 300ms 缓冲
        }, 50);
    }
  }, [ggbApplet, pendingCommands]);

  // 处理文件选择
  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile || !selectedFile.type.startsWith('image/')) {
      alert('请上传有效的图片文件 (JPG, PNG).');
      return;
    }
    setFile(selectedFile);
    
    // 生成预览
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(selectedFile);
    
    // 重置状态
    setIsGenerated(false);
    setProblemType(null);
    setProblemText(''); // 重置文本输入
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  };

  const handleRegenerate = () => {
    setIsGenerated(false);
    setIsLoading(true);
    setProgress(0);
    setProblemType(null);
    handleGenerate();
  };

  const toggleFullscreen = (value: boolean) => {
    setIsFullscreen(value);
  };
  
  // 监听全屏状态并调整 GGB 尺寸 (CSS 缩放版)
  useEffect(() => {
    if (isFullscreen) {
        const handleResize = () => {
            const container = document.querySelector('.ggb-fullscreen-wrapper') as HTMLElement;
            if (container) {
                // 计算缩放比例：保留 5% 边距，确保 900x600 的内容能完整放入屏幕
                const scale = Math.min(window.innerWidth / 900, window.innerHeight / 600) * 0.95;
                container.style.setProperty('--ggb-scale', scale.toString());
            }
        };

        // 立即执行一次
        handleResize();
        // 监听窗口变化
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }
  }, [isFullscreen]);

  const handleGenerate = async () => {
    if (!file) return;

    setIsLoading(true);
    setProgress(0); // 显式重置进度条为 0
    setLoadingText("正在识别题目图像信息..."); // 确保普通生成时也重置
    setProblemType(null);
    
    // 清空画板
    if (ggbApplet) {
      ggbApplet.newConstruction();
    }

    const formData = new FormData();
    formData.append('image', file);
    if (problemText) {
        formData.append('text', problemText);
    }

    try {
      // 使用 CORS 直连 Flask 后端
      const backendUrl = 'http://localhost:5000/upload'; 
      
      const response = await fetch(backendUrl, {
        method: 'POST',
        body: formData
      });

      console.log('Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Server error response:', errorText);
        throw new Error(`Server Error (${response.status}): ${errorText}`);
      }

      // 流式读取响应
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (!reader) throw new Error('Response body is unavailable');

      while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // 保留最后一个可能不完整的片段
          buffer = lines.pop() || ''; 
          
          for (const line of lines) {
              if (!line.trim()) continue;
              
              try {
                  const data = JSON.parse(line);
                  
                  if (data.error) {
                      throw new Error(data.error);
                  }

                  if (data.status === 'classified') {
                      // 阶段 1: 识别完成
                      console.log('题目分类完成:', data.category);
                      setProblemType(data.category);
                      setLoadingText("正在调用专家模型生成指令...");
                  } else if (data.status === 'completed') {
                      // 阶段 2: 生成完成
                      console.log('Received commands:', data.commands);
                      
                      const rawData = data.commands;
                      const validCommands: string[] = [];

                      if (Array.isArray(rawData)) {
                          rawData.forEach((item: string) => {
                              const subLines = item.split(/\r?\n|\\n/);
                              subLines.forEach(line => {
                                  const cmd = line.trim();
                                  // 过滤无效指令：
                                  // 1. 空行、注释、Markdown 标记
                                  // 2. 包含中文字符的行 (通常是模型输出的思考过程)
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
                      
                      console.log('解析后的有效指令数:', validCommands.length);
                      setPendingCommands(validCommands);
                      
                      // --- 完成阶段 (finishProgress) ---
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

    } catch (err: any) {
      console.error(err);
      alert('Error: ' + err.message);
      setIsLoading(false); // 发生错误时也要停止 Loading
    } finally {
      // finally 块不再强制设置为 false，因为成功的逻辑里有延迟设置
    }
  };

  // 导出功能
  const handleExport = (type: 'html' | 'ggb') => {
    if (!ggbApplet || !isGenerated) return;

    ggbApplet.getBase64((base64: string) => {
      if (!base64) {
        alert('无法获取 GGB 数据');
        return;
      }

      if (type === 'ggb') {
        downloadBlob(base64ToBlob(base64, 'application/vnd.geogebra.file'), 'math_demo.ggb');
      } else {
        const htmlContent = generateExportHTML(base64);
        downloadBlob(new Blob([htmlContent], { type: 'text/html' }), 'math_demo.html');
      }
      setIsExportMenuOpen(false);
    });
  };

  // 辅助函数
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
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Math Demo Export</title>
    <style>
        body { margin: 0; padding: 20px; font-family: sans-serif; background: #f5f5f5; }
        .container { max-width: 900px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        h1 { text-align: center; color: #333; padding: 20px; margin: 0; border-bottom: 1px solid #eee; }
        #ggb-element { width: 100%; height: 600px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Math Visualization</h1>
        <div id="ggb-element"></div>
    </div>
    <script src="https://www.geogebra.org/apps/deployggb.js"></script>
    <script>
        var params = {
            "appName": "classic",
            "width": 900,
            "height": 600,
            "showToolBar": false,
            "showAlgebraInput": false,
            "showMenuBar": false,
            "ggbBase64": "${base64}"
        };
        var applet = new GGBApplet(params, true);
        window.onload = function() { applet.inject('ggb-element'); };
    </script>
</body>
</html>`;
  };

  return (
    <div className="flex h-screen w-full bg-[#FDFCF8] font-sans text-stone-800 overflow-hidden selection:bg-emerald-100 selection:text-emerald-900">
      
      {/* 1. Left Sidebar (Fixed) */}
      <aside className="w-64 bg-[#FDFCF8] border-r border-stone-200 flex flex-col z-30 flex-shrink-0">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-sm transform -rotate-2">
            M
          </div>
          <span className="font-bold text-lg tracking-tight text-stone-800">MathMover</span>
        </div>

        <div className="px-4 mb-6">
          <button 
            onClick={() => {
                setFile(null);
                setPreviewUrl(null);
                setIsGenerated(false);
                if (ggbApplet) ggbApplet.newConstruction();
            }}
            className="w-full bg-gradient-to-r from-emerald-500 to-green-600 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[4px_4px_0px_0px_rgba(6,95,70,0.1)] hover:shadow-[2px_2px_0px_0px_rgba(6,95,70,0.1)] hover:translate-x-[2px] hover:translate-y-[2px] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none border-2 border-transparent"
          >
            <Plus className="w-5 h-5 stroke-[3]" />
            <span>新建课件</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
           <div className="px-3 py-1.5 text-xs font-black text-stone-400 uppercase tracking-wider mb-2">我的工作室</div>
           <a href="#" className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-50/80 border border-emerald-100 text-emerald-800 font-bold relative transition-colors">
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-emerald-500 rounded-r-full"></div>
              <LayoutGrid className="w-5 h-5 text-emerald-600" />
              全部项目
           </a>
        </div>

        <div className="p-4 border-t border-stone-200">
          <button className="flex items-center gap-3 w-full p-2 rounded-xl hover:bg-white transition-all text-left group border border-transparent hover:border-stone-200 hover:shadow-sm">
            <div className="w-10 h-10 rounded-full bg-lime-100 border-2 border-stone-100 flex items-center justify-center text-lime-700 font-black text-sm">
              D
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-stone-700 group-hover:text-stone-900">Derek</div>
            </div>
            <Settings className="w-4 h-4 text-stone-300 group-hover:text-stone-500" />
          </button>
        </div>
      </aside>

      {/* 2. Middle Canvas Area (Fluid) */}
      <main className="flex-1 relative flex flex-col bg-[#F5F5F0]/50 h-full overflow-hidden">
        
        {/* Header */}
        {!isFullscreen && (
          <header className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between p-4 pointer-events-none">
             <div className="pointer-events-auto flex items-center gap-2 bg-white/40 backdrop-blur-md border border-stone-200/50 shadow-sm px-1 py-1 rounded-xl pl-3 opacity-50 hover:opacity-100 hover:bg-white/80 transition-all duration-300">
                <span className="text-xs font-bold text-stone-500">项目 /</span>
                <div className="flex items-center gap-1 cursor-pointer hover:bg-stone-50/50 px-2 py-1 rounded-lg -ml-1 transition-colors group">
                   <h1 className="font-bold text-sm text-stone-700 group-hover:text-emerald-600 transition-colors">
                      {file ? file.name : "未命名课件"}
                   </h1>
                   <ChevronDown className="w-3 h-3 text-stone-400 group-hover:text-emerald-500 stroke-[3]" />
                </div>
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
                {/* 统一的图片上传区：无论是点击还是拖拽，都触发上传 */}
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
                            placeholder="输入题目补充信息（可选，如模糊文字、隐含条件）..."
                            className="w-full max-w-[400px] bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all duration-300 resize-none h-10 focus:h-32 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                    </div>

                    {/* Dynamic Action Area (Flex-Shrink-0) */}
                    <div className="flex-shrink-0 w-[160px] h-[52px] flex items-end">
                        {isLoading ? (
                            <button 
                                disabled
                                className="w-full h-[42px] bg-stone-100 text-stone-400 font-bold rounded-xl shadow-none flex items-center justify-center gap-2 cursor-not-allowed"
                            >
                                <Loader2 className="w-5 h-5 animate-spin" />
                                生成中...
                            </button>
                        ) : isGenerated ? (
                             <button 
                                 onClick={handleRegenerate}
                                 className="w-full h-[42px] bg-white border-2 border-stone-200 text-stone-600 font-bold rounded-xl shadow-sm hover:border-emerald-400 hover:text-emerald-600 hover:shadow-md hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
                             >
                                 <RefreshCw className="w-5 h-5 stroke-[2.5]" />
                                 重新生成
                             </button>
                        ) : previewUrl ? (
                             <button 
                                 onClick={handleGenerate}
                                 className="w-full h-[42px] bg-emerald-500 text-white font-bold rounded-xl shadow-lg hover:bg-emerald-600 hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
                             >
                                 <RefreshCw className="w-5 h-5 stroke-[3]" />
                                 生成演示
                             </button>
                        ) : (
                             <div className="w-full h-[42px]"></div> // 占位
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
                 ? 'ggb-fullscreen-wrapper' // 全屏态：使用 CSS 类控制
                 : `relative ${!isGenerated ? 'opacity-100 grayscale pointer-events-none' : ''} bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden inline-block` // 普通态：卡片样式
             }
          >
              {/* CSS 强力覆盖：消除 GGB 黑边 + 全屏缩放逻辑 */}
              <style jsx global>{`
                 #ggb-element, #ggb-element > div { 
                    border: none !important; 
                    outline: none !important; 
                    box-shadow: none !important; 
                 }
                 
                 /* 全屏容器 */
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
                 
                 /* 全屏内容区：应用动态缩放 */
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
                                           // 逻辑修正：
                                           // 1. 如果 slider.value 是数字，说明是来自 GGB 的同步值 -> 格式化显示
                                           // 2. 如果 slider.value 是字符串，说明是用户正在输入的值 -> 原样显示
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
                    onClick={(e) => e.stopPropagation()} // 防止点击图片关闭
                />
            </div>
        </div>
      )}

    </div>
  );
}
