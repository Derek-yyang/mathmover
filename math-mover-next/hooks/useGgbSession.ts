'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { GeoGebraApi, AuditResult } from '@/components/dashboard/types';
// 体检算法唯一真源在 ggb-core。只走 /probe 子路径，不从整包引（见 types.ts 顶部说明）。
import { auditConstruction } from '@mathmover/ggb-core/probe';
import { animateViewToCenter, readViewBounds } from '@/lib/ggb-view-transition';
import { resetStandard3DView } from '@/lib/ggb-view-reset';
import { createCoursewareHTML } from '@/lib/ggb-html-export';
import { getCoursewarePNG } from '@/lib/ggb-png-export';
import { watchGgbGraphics } from '@/lib/ggb-graphics-state';
import { noteRenderTrouble } from '@/lib/render-trouble';

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
  /** 上一次**定下**的画板模式（见下面的模式判定：不能用实时读数兜底） */
  const decidedModeRef = useRef<'2D' | '3D' | null>(null);
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
      // 没有 `mode` 选项：模式**只从命令里的 MODE: 行来**（没有就沿用上一次定下的），
      // 外部传一个模式进来会与稿子打架——实测没人传过，别留这个会误导的旋钮。
      commands: string[],
      opts: { incremental?: boolean } = {}
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

        // 识别模式：**显式 MODE: 行优先**，没有就沿用上一次定下的模式。
        //
        // ⚠ 兜底**不能**用实时读数（`currentMode`）：增量下发时 `commands` 里没有 MODE 行
        //（它只在首轮那份全量里），而实时读数的判据是「512 可见 **且** 1 不可见」——
        // 透视切换途中两者会同时可见，那一刻被读成 2D。于是下一轮增量 apply 就把 3D 画布
        // 翻回 2D（用户 2026-10-19 报的「构造 3D 中途转到 2D」就是这条路：一轮 edit 打断纯追加
        // → 下一轮全量 → 之后又是增量，中间夹一次错读就翻过去了）。
        let targetMode: '2D' | '3D' = decidedModeRef.current ?? currentMode;
        const modeCmd = commands.find((c) => c.trim().startsWith('MODE:'));
        if (modeCmd) {
          if (modeCmd.includes('3D')) targetMode = '3D';
          else if (modeCmd.includes('2D')) targetMode = '2D';
        }
        decidedModeRef.current = targetMode;
        setCurrentMode(targetMode);

        const commandsToRun = commands.filter((cmd) => {
          const trimmed = cmd.trim();
          return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('MODE:');
        });

        /**
         * 这一轮要执行的命令里有没有**取景**（都是相对命令）。
         *
         * 为什么要单独认出来：增量下发把「插入位置之后」的行整段当成新行重跑，取景行只要
         * 不在文件末尾就会被反复执行，而 `ZoomIn` 是**相对当前倍率**的乘法 ⇒ 倍率越叠越大。
         * 实测 50 → 300 → 1800 → 10800，PNG 从 10 万字节掉到 2.6 万——**看着就是一片白**
         * （用户 2026-10-19 报的「不是全白，是视角放得太大」）。
         * 对策见下面：只要这轮有取景，就先把相机回标准，让「同一份稿子 ⇒ 同一个视角」。
         */
        const FRAMING_CMD = /^\s*(ZoomIn|ZoomOut|CenterView|SetViewDirection)\s*\(/i;
        const hasFraming = commandsToRun.some((cmd) => FRAMING_CMD.test(cmd));

        /**
         * **绝不重跑**的指令：相对/有状态的，重跑一次结果就变一次。
         *
         * 为什么需要单独一条：`evalCommand` 对**视图类命令成功时也返回 false**——与
         * `Set*`/`Show*` 同一类「假失败」（`ZoomIn` / `CenterView` / `SetViewDirection`
         * 三条实测全返回 false，而它们都真的生效了）。于是下面那遍「补漏」会把它们当成
         * 失败原样重跑，而它们恰恰**不是**幂等的：
         *  - `ZoomIn/ZoomOut` 是相对当前倍率的乘法，重跑 = 再乘一遍；
         *  - `SetViewDirection` 的「方向向量 → 角度」换算带一个滚转自由度，同一个目标
         *    向量从不同起始态会落到 (35.3,-45) 或它的镜像 (-35.3,135)——重跑正好落到镜像上。
         *
         * 实测同一份 3D 稿（取景 `CenterView` + `SetViewDirection` + `ZoomIn(3)`）：
         * 一遍 → scale 150、朝向 (35.3,-45)、PNG 169k（正常）；两遍 → scale **374**、
         * 朝向翻到镜像、PNG 125k——画面上就是「放得太大、贴到图形上」（用户 2026-10-19 报的）。
         * `CenterView` 是绝对命令（重跑落在同一个中心）故不在此列，属性类同理。
         */
        const NON_IDEMPOTENT_CMD = /^\s*(ZoomIn|ZoomOut|SetViewDirection)\s*\(/i;

        /**
         * 画布**当前显示**的是不是 3D。视图设置该不该跑要看它，不能只看 `opts.incremental`：
         *
         * daemon 的增量判定是「新账本是不是当前账本的纯追加」，而**空画布 + 任何新账本**都算
         * 纯追加（`pureAppendDelta([], list)` 非空）。于是新建课件 / `ggb_reset` 之后的
         * 第一份 3D 稿会被判成增量 → 这段视图设置整段被跳过 → 透视没切 → 3D 对象在 2D 视图里
         * 根本不画 → **用户看到整块白屏**（agent 取到的截图也是白的，只能自己往稿子里补
         * `SetActiveView(3)` 自救）。三个现场（新建课件、清屏后、2D 课件改画立体）都是这条路。
         */
        const liveIs3D = (): boolean => {
          if (typeof ggbApplet.getPerspectiveXML !== 'function') return targetMode === '3D';
          try {
            return /view id="512"[^>]*visible="true"/.test(ggbApplet.getPerspectiveXML());
          } catch {
            return targetMode === '3D';
          }
        };

        // 换模式 = 视图也得换：与增量无关（增量只决定要不要清屏）
        const switchView = !opts.incremental || liveIs3D() !== (targetMode === '3D');

        // 清屏只在非增量时做（增量的语义是「同一份构造继续长」）
        if (!opts.incremental) {
          try {
            ggbApplet.newConstruction();
          } catch {}
        }

        if (switchView) {
          if (targetMode === '2D') {
            try {
              ggbApplet.setPerspective('G');
              ggbApplet.setAxesVisible(true, true);
              ggbApplet.setGridVisible(true);
            } catch {}
          } else {
            try {
              ggbApplet.setPerspective('T');
              // 3D 的轴要**点名 view 3**（四参形式）。三参 `setAxesVisible(true,true,true)`
              // 在 3D 下是**空操作**（实测三个轴的 show 位一动不动，三参只作用于 2D）——
              // 写「3D 开轴」就得用四参，否则这行等于没写。它在稿子之前执行，
              // 稿子的 `ShowAxes(3, …)` 仍是最终决定（技能里也这么告诉 agent）。
              ggbApplet.setAxesVisible(3, true, true, true);
              ggbApplet.setGridVisible(true);
              // 3D 默认不开网格。无编号的 setGridVisible(true) 只作用于 2D（实测），
              // 3D 得点名 view 3；而 3D 网格状态会被 GeoGebra 自己持久化，
              // 不显式关掉就会带着上次的勾选打开。
              ggbApplet.setGridVisible(3, false);
            } catch {}
          }
        }

        // 视图就绪等待探针
        //
        // ⚠ 3D 的就绪判据**不能**用 `getViewProperties`：3D 下 `getViewProperties(2)` 返回 `{}`，
        // `!!{}` 为真——探针等于空转；而 `getViewProperties(3)` 与 `getGraphicsOptions(-1)`
        // 更坑：3D 视图**还不存在**时，前者返回 2D 的几何、后者照样返回一份像样的 3D 选项对象
        //（三条都实测过）。唯一说真话的是**透视 XML 里 3D 视图（id 512）的 visible 位**：
        // 不存在时 false、就位后 true。
        //
        // 空转的代价实测过：命令灌进还没初始化的 3D 视图 → 用户看到整块**白帧**，
        // agent 取到的截图也是白的（它只能自己反复 poke 才渲染出来，白烧几轮往返）。
        const viewReady = (): boolean => {
          if (targetMode === '3D') {
            if (typeof ggbApplet.getPerspectiveXML !== 'function') return true;   // 老 applet：不拦
            try {
              return /view id="512"[^>]*visible="true"/.test(ggbApplet.getPerspectiveXML());
            } catch {
              return true;
            }
          }
          // 2D 视图从 applet 创建起就在，这一支实际从不等待（保留原判据）
          return typeof ggbApplet.getViewProperties === 'function'
            ? !!ggbApplet.getViewProperties(1)
            : true;
        };
        const waitForView = (cb: () => void) => {
          if (!switchView) {
            cb();
            return;
          }
          let waited = 0;
          const tick = () => {
            if (execSessionRef.current !== session) { done(null); return; }
            const ready = viewReady();
            if (ready || waited >= 4000) {
              // 等到点了仍没就绪：留一条痕迹（同一通道，复现后一行读出）——
              // 「客户端看不见的白屏」只能靠这种落盘的证据来查。
              if (!ready && targetMode === '3D') {
                noteRenderTrouble('3d-view-not-ready', {
                  waited,
                  view512: (() => {
                    try { return /view id="512"[^>]*visible="(\w+)"/.exec(ggbApplet.getPerspectiveXML?.() ?? '')?.[1] ?? null; } catch { return null; }
                  })(),
                  pngBytes: (() => {
                    try { return ggbApplet.getPNGBase64?.(1, false)?.length ?? null; } catch { return null; }
                  })(),
                });
                // 止损：把透视切换重发一次（已在该视角时是空操作、重复无害），
                // agent 遇白帧时手工做的也正是这一步。
                try {
                  ggbApplet.setPerspective('T');
                  ggbApplet.refreshViews();
                } catch {}
              }
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

          // 全量重建的 3D：**相机也回标准**，给稿子里的取景一个确定起点。
          //
          // 稿子里的取景只有相对手段：`ZoomIn/ZoomOut` 是「相对当前」的倍数，而 3D 相机
          // 跨课件残留（切课件不重置它）——于是同一份稿子在别的画布上会落到不同远近，
          // 实测有一轮叠到了立方体内部（视域只剩 ±0.08 单位，图看着像没了）。
          // 绝对手段都不在指令面上（实测）：`SetViewDirection()` 只回朝向不动缩放、
          // 2D 的框缩放重载 `ZoomIn(x1,y1,x2,y2)` 在 3D 下完全无效、`setCoordSystem`
          // 是 JS API 不许写进指令流。所以确定性只能由宿主这边给。
          // 一次到位不带过渡：用户此刻看的是「正在长出来的图」，不需要视角动画。
          //
          // `hasFraming` 也要回标准（不只是全量重建时）：增量重跑取景行是**常态**
          //（取景行不在末尾就会被卷进增量），不回标准就会叠成一片白。回标准之后
          // 「取景倍率」始终相对标准视域——这正是技能里告诉 agent 的那个假设
          //（「取景起点由宿主给，倍率按标准视域估就行」）。
          //
          // `extremeScale` 是**自愈**：相机跨课件残留，历史遗留（修复前叠坏的）或别的路径
          // 把它留在一个没人会要的区间时，画面就是一片白。判据取 600：技能给 agent 的
          // 取景区间是标准视域的 5~10 倍（250~500），再往上不是"想要"，是坏了。
          const scale3D = (): number => {
            if (targetMode !== '3D') return 0;
            try {
              const block = /<euclidianView3D>[\s\S]*?<\/euclidianView3D>/.exec(ggbApplet.getXML?.() ?? '')?.[0] ?? '';
              return Number(/scale="(-?[\d.]+)"/.exec(block)?.[1] ?? '');
            } catch { return 0; }
          };
          const before = scale3D();
          const extremeScale = Number.isFinite(before) && (before > 600 || before < 5);
          if ((switchView || hasFraming || extremeScale) && targetMode === '3D') {
            resetStandard3DView(ggbApplet, { durationMs: 0 });
            if (extremeScale && !switchView && !hasFraming) {
              noteRenderTrouble('3d-scale-healed', { before, session });
            }
          }
          // 2D 的取景同样是相对乘法（`ZoomIn`），同理回标准：中心 (0,0)、倍率 50。
          // `ZoomIn` 读不到绝对值，但「当前倍率」读得到，所以用 50/当前 一步到位。
          if ((switchView || hasFraming) && targetMode === '2D') {
            try {
              const xml = ggbApplet.getXML?.() ?? '';
              const view = /<euclidianView>[\s\S]*?<\/euclidianView>/.exec(xml)?.[0] ?? '';
              const scale = Number(/scale="(-?[\d.]+)"/.exec(view)?.[1] ?? '');
              ggbApplet.evalCommand('CenterView((0,0))');
              if (Number.isFinite(scale) && scale > 0) ggbApplet.evalCommand(`ZoomIn(${(50 / scale).toFixed(6)})`);
            } catch {}
          }

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

          // 3D 视域体检：这轮跑完落在没人会要的区间就记一条（带 scale、有没有取景、
          // 有没有回标准）——"白"这件事在客户端看不见，只能靠落盘证据查。
          if (targetMode === '3D') {
            const after = scale3D();
            if (Number.isFinite(after) && (after > 600 || after < 5)) {
              noteRenderTrouble('3d-scale-extreme', { scale: after, hasFraming, switchView, session });
            }
          }

          // 第二遍补漏/属性 —— 但**不重跑非幂等的视图命令**（见 NON_IDEMPOTENT_CMD：
          // 它们成功时也返回 false，重跑会把取景再乘一遍、把朝向翻到镜像）。
          const retryable = failed.filter((cmd) => !NON_IDEMPOTENT_CMD.test(cmd));
          if (retryable.length > 0) {
            setTimeout(() => {
              if (execSessionRef.current !== session) { done(null); return; }
              execList(retryable);
            }, 300);
          }

          // 2D 坐标自适应中心与视野 (仅全量初始构建时执行)
          if (switchView && targetMode === '2D') {
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

          // 落地之后再确认一次「3D 视图还在布局里」。白帧的现场就是「kernel 里对象都在、
          // 屏幕上什么都没有」——重发一次透视切换（已在该视角时是空操作、重复无害）
          // 把它拉回来；agent 手工自救做的也正是这一步。
          if (switchView && targetMode === '3D' && !viewReady()) {
            try {
              ggbApplet.setPerspective('T');
              ggbApplet.refreshViews();
            } catch {}
          }

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
          // 四参、点名 view 3 —— 三参形式在 3D 下是**空操作**（实测三个轴的 show 位不动）
          ggbApplet.setAxesVisible(3, visible, visible, visible);
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
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      // 3D 没有可用的「回正」命令——相机只能经 XML 复位（原因见 lib/ggb-view-reset.ts）。
      // 逐帧补丁也是动画，同样交给 cancelViewAnimation 中止（抓画布 / Esc 都能打断）。
      if (currentMode === '3D') {
        cancelViewAnimationRef.current = resetStandard3DView(ggbApplet, { reducedMotion });
        return;
      }
      const bounds = ggbApplet.setCoordSystem
        ? readViewBounds(ggbApplet.getViewProperties?.(1))
        : null;
      if (bounds) {
        cancelViewAnimationRef.current = animateViewToCenter(
          view => ggbApplet.setCoordSystem!(view.xMin, view.xMax, view.yMin, view.yMax),
          bounds,
          { reducedMotion },
        );
        return;
      }
      // 老 applet（没有 setCoordSystem）：沿用旧的 2D 处理，别动
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
