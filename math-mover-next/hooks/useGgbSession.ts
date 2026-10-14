'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { GeoGebraApi, AuditResult } from '@/components/dashboard/types';
// 体检算法唯一真源在 ggb-core。只走 /probe 子路径，不从整包引（见 types.ts 顶部说明）。
import { auditConstruction } from '@mathmover/ggb-core/probe';
import { animateViewToCenter, readViewBounds } from '@/lib/ggb-view-transition';
import { createCoursewareHTML } from '@/lib/ggb-html-export';
import { getCoursewarePNG } from '@/lib/ggb-png-export';
import { watchGgbGraphics } from '@/lib/ggb-graphics-state';

interface UseGgbSessionOptions {
  onAuditCompleted?: (audit: AuditResult) => void;
  onError?: (error: string) => void;
}

export function useGgbSession(options: UseGgbSessionOptions = {}) {
  const [ggbApplet, setGgbApplet] = useState<GeoGebraApi | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [lastExecutedCommands, setLastExecutedCommands] = useState<string[]>([]);
  const [currentMode, setCurrentMode] = useState<'2D' | '3D'>('2D');
  useEffect(() => ggbApplet ? watchGgbGraphics(ggbApplet, state => setCurrentMode(state.mode)) : undefined, [ggbApplet]);

  const execSessionRef = useRef(0);
  const cancelViewAnimationRef = useRef<(() => void) | null>(null);
  const cancelViewAnimation = useCallback(() => {
    cancelViewAnimationRef.current?.();
    cancelViewAnimationRef.current = null;
  }, []);

  // Direct manipulation takes priority over the brief recenter transition.
  useEffect(() => {
    const interrupt = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.GeoGebraFrame')) {
        cancelViewAnimation();
      } else if (event instanceof KeyboardEvent && event.key === 'Escape') {
        cancelViewAnimation();
      }
    };
    const onVisibility = () => {
      if (document.hidden) cancelViewAnimation();
    };
    document.addEventListener('pointerdown', interrupt, true);
    document.addEventListener('wheel', interrupt, { capture: true, passive: true });
    document.addEventListener('keydown', interrupt, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', cancelViewAnimation);
    window.addEventListener('resize', cancelViewAnimation);
    const frame = document.querySelector('.GeoGebraFrame');
    const observer = new ResizeObserver(cancelViewAnimation);
    if (frame) observer.observe(frame);
    return () => {
      cancelViewAnimation();
      observer.disconnect();
      document.removeEventListener('pointerdown', interrupt, true);
      document.removeEventListener('wheel', interrupt, true);
      document.removeEventListener('keydown', interrupt, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', cancelViewAnimation);
      window.removeEventListener('resize', cancelViewAnimation);
    };
  }, [ggbApplet, currentMode, cancelViewAnimation]);

  // 绑定初始化句柄
  const handleAppletReady = useCallback((api: GeoGebraApi) => {
    cancelViewAnimation();
    setGgbApplet(api);
    setIsReady(true);
  }, [cancelViewAnimation]);

  // 执行 GGB 指令全流程（支持 replaceAll 全量覆盖 或 incremental 局部增量执行）
  const executeCommands = useCallback(
    (
      commands: string[],
      opts: { mode?: '2D' | '3D'; incremental?: boolean } = {}
    ): Promise<AuditResult | null> => {
      return new Promise((resolve) => {
        // 所有出口都必须落定——否则调用方会永久挂起（本函数有多个
        // 「会话已切换就 return」的早退路径，历史上它们不 resolve）。
        let settled = false;
        const done = (value: AuditResult | null) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        if (!ggbApplet) {
          done(null);
          return;
        }

        execSessionRef.current += 1;
        cancelViewAnimation();
        const session = execSessionRef.current;

        // 识别模式
        let targetMode: '2D' | '3D' = opts.mode || currentMode;
        const modeCmd = commands.find((c) => c.trim().startsWith('MODE:'));
        if (modeCmd) {
          if (modeCmd.includes('3D')) targetMode = '3D';
          else if (modeCmd.includes('2D')) targetMode = '2D';
        }
        setCurrentMode(targetMode);

        const commandsToRun = commands.filter((cmd) => {
          const trimmed = cmd.trim();
          return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('MODE:');
        });

        // 仅在非增量模式下清空画布
        if (!opts.incremental) {
          try {
            ggbApplet.newConstruction();
          } catch {}

          if (targetMode === '2D') {
            try {
              ggbApplet.setPerspective('G');
              ggbApplet.setAxesVisible(true, true);
              ggbApplet.setGridVisible(true);
            } catch {}
          } else {
            try {
              ggbApplet.setPerspective('T');
              ggbApplet.setAxesVisible(true, true, true);
              ggbApplet.setGridVisible(true);
            } catch {}
          }
        }

        // 视图就绪等待探针
        const waitForView = (cb: () => void) => {
          if (opts.incremental) {
            cb();
            return;
          }
          const viewIndex = targetMode === '2D' ? 1 : 2;
          let waited = 0;
          const tick = () => {
            if (execSessionRef.current !== session) { done(null); return; }
            let ready = false;
            try {
              ready =
                typeof ggbApplet.getViewProperties === 'function'
                  ? !!ggbApplet.getViewProperties(viewIndex)
                  : true;
            } catch {
              ready = true;
            }
            if (ready || waited >= 2500) {
              cb();
              return;
            }
            waited += 100;
            setTimeout(tick, 100);
          };
          setTimeout(tick, 60);
        };

        waitForView(() => {
          if (execSessionRef.current !== session) { done(null); return; }

          const execList = (list: string[]) => {
            const failed: string[] = [];
            list.forEach((cmd) => {
              try {
                const clean = cmd.replace(/\\"/g, '"');
                const ok = ggbApplet.evalCommand(clean);
                if (ok === false) failed.push(cmd);
              } catch (e) {
                failed.push(cmd);
              }
            });
            return failed;
          };

          // 第一遍创建/更新
          const failed = execList(commandsToRun);

          // 第二遍补漏/属性
          if (failed.length > 0) {
            setTimeout(() => {
              if (execSessionRef.current !== session) { done(null); return; }
              execList(failed);
            }, 300);
          }

          // 2D 坐标自适应中心与视野 (仅全量初始构建时执行)
          if (!opts.incremental && targetMode === '2D') {
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

          try {
            ggbApplet.refreshViews();
            if (ggbApplet.recalcDisplay) ggbApplet.recalcDisplay();
          } catch {}

          const mergedCommands = opts.incremental
            ? [...lastExecutedCommands, ...commandsToRun]
            : commandsToRun;
          setLastExecutedCommands(mergedCommands);

          // 延迟体检
          setTimeout(() => {
            if (execSessionRef.current !== session) { done(null); return; }
            const audit = auditConstruction(ggbApplet, mergedCommands);
            if (options.onAuditCompleted) {
              options.onAuditCompleted(audit);
            }
            done(audit);
          }, 500);
        });
      });
    },
    [ggbApplet, currentMode, lastExecutedCommands, options, cancelViewAnimation]
  );

  // 视图控制
  const setAxesVisible = useCallback(
    (visible: boolean) => {
      if (!ggbApplet) return;
      try {
        if (currentMode === '3D') {
          ggbApplet.setAxesVisible(visible, visible, visible);
        } else {
          ggbApplet.setAxesVisible(visible, visible);
        }
      } catch {}
    },
    [ggbApplet, currentMode]
  );

  const setGridVisible = useCallback(
    (visible: boolean) => {
      if (!ggbApplet) return;
      try {
        ggbApplet.setGridVisible(visible);
      } catch {}
    },
    [ggbApplet]
  );

  const resetView = useCallback(() => {
    if (!ggbApplet) return;
    cancelViewAnimation();
    try {
      const bounds = currentMode === '2D' && ggbApplet.setCoordSystem
        ? readViewBounds(ggbApplet.getViewProperties?.(1))
        : null;
      if (bounds) {
        cancelViewAnimationRef.current = animateViewToCenter(
          view => ggbApplet.setCoordSystem!(view.xMin, view.xMax, view.yMin, view.yMax),
          bounds,
          { reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches },
        );
        return;
      }
      // Keep the previous behavior for 3D or older applet APIs.
      ggbApplet.evalCommand('CenterView((0,0))');
      ggbApplet.evalCommand('ZoomIn(-10)');
      ggbApplet.refreshViews();
    } catch {}
  }, [ggbApplet, currentMode, cancelViewAnimation]);

  const clearConstruction = useCallback(() => {
    if (!ggbApplet) return;
    cancelViewAnimation();
    try {
      ggbApplet.newConstruction();
      setLastExecutedCommands([]);
    } catch {}
  }, [ggbApplet, cancelViewAnimation]);

  // 导出 GGB 文件 (.ggb)
  const exportGGB = useCallback((filename = 'mathmover_courseware.ggb') => {
    if (!ggbApplet) return;
    try {
      ggbApplet.getBase64((base64Data: string) => {
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/vnd.geogebra.file' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename.endsWith('.ggb') ? filename : `${filename}.ggb`;
        link.click();
        URL.revokeObjectURL(link.href);
      });
    } catch (e) {
      console.error('Failed to export GGB:', e);
    }
  }, [ggbApplet]);

  // HTML 内嵌当前画板快照；打开文件只需要浏览器和在线 GeoGebra runtime。
  const exportHTML = useCallback((filename = 'mathmover_courseware.html', title = 'MathMover 交互课件') => {
    return new Promise<void>((resolve, reject) => {
      if (!ggbApplet) {
        reject(new Error('画板尚未加载完成，请稍后重试。'));
        return;
      }
      try {
        ggbApplet.getBase64((base64Data: string) => {
          try {
            const html = createCoursewareHTML(base64Data, title);
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.href = url;
            link.download = filename.endsWith('.html') ? filename : `${filename}.html`;
            document.body.appendChild(link);
            try {
              link.click();
              resolve();
            } finally {
              link.remove();
              // Delay revocation so the browser can consume the download URL.
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }, [ggbApplet]);

  // 导出画板 PNG 截图
  const exportPNG = useCallback((filename = 'mathmover_preview.png') => {
    if (!ggbApplet) return false;
    try {
      const dataUrl = getCoursewarePNG(ggbApplet, () => {
        const canvas = document.querySelector<HTMLCanvasElement>('#ggb-element canvas');
        return canvas?.toDataURL('image/png') ?? null;
      });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename.endsWith('.png') ? filename : `${filename}.png`;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
      return true;
    } catch (e) {
      console.error('Failed to export PNG:', e);
      return false;
    }
  }, [ggbApplet]);

  return {
    ggbApplet,
    isReady,
    currentMode,
    lastExecutedCommands,
    restoreCommandLedger: setLastExecutedCommands,
    handleAppletReady,
    executeCommands,
    setAxesVisible,
    setGridVisible,
    resetView,
    clearConstruction,
    exportGGB,
    exportHTML,
    exportPNG,
  };
}
