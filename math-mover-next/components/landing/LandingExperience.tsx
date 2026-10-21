'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronDown, ChevronRight, ImagePlus, MousePointer2, PanelLeftClose, PanelLeftOpen, Pause, Play, Plus, RotateCcw, RotateCw, Search, Settings2, Square } from 'lucide-react';
import ControlDeck from '@/components/dashboard/ControlDeck';
import styles from '@/app/landing.module.css';
import { createCaseWheelGesture } from './case-wheel-gesture';
import { GraphHandle } from './GraphHandle';

type Example = 'ellipse' | 'function' | 'space';
type Point = [number, number];
const focalDistance = Math.sqrt(7);
const motionQuery = '(prefers-reduced-motion: reduce)';
function subscribeMotion(listener: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
const readReducedMotion = () => window.matchMedia(motionQuery).matches;
const serverReducedMotion = () => false;
const compactQuery = '(max-width: 640px)';
function subscribeCompact(listener: () => void) {
  const media = window.matchMedia(compactQuery);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
const readCompact = () => window.matchMedia(compactQuery).matches;
const serverCompact = () => false;

function Graph({ example, value, construction = 7, rotation = 0, workbench = false, showAxes = true, showGrid = true, onValueChange }: { example: Example; value: number; construction?: number; rotation?: number; workbench?: boolean; showAxes?: boolean; showGrid?: boolean; onValueChange?: (value: number) => void }) {
  const accent = workbench ? 'var(--mm-text-emerald-700)' : '#6ee7b7';
  const ink = workbench ? 'var(--foreground)' : '#e7eeeb';
  const subdued = workbench ? 'var(--mm-text-stone-500)' : '#9aa8a2';
  const graphId = useId().replace(/:/g, '');
  const project = ([x, y]: Point): Point => [440 + x * 62, 265 - y * 62];
  const p = (point: Point) => project(point).join(',');
  const dot = (point: Point, name: string, color = ink, dx = 13, dy = -13) => {
    const [x, y] = project(point);
    const marker = <><circle cx={x} cy={y} r={5} fill={color} stroke={workbench ? 'var(--mm-canvas-shell)' : '#141b19'} strokeWidth={2} /><text x={x + dx} y={y + dy} fill={color}>{name}</text></>;
    if (name === 'P' && onValueChange && example !== 'space') return <GraphHandle key={name} position={[x, y]} label={`动点 P（${example === 'ellipse' ? '椭圆' : '抛物线'}）`} value={value} min={example === 'ellipse' ? 0 : -2.8} max={example === 'ellipse' ? 360 : 2.8} step={example === 'ellipse' ? 1 : .01} valueText={example === 'ellipse' ? `${Math.round(value)} 度` : `横坐标 ${value.toFixed(2)}`} onChange={onValueChange} toValue={([px, py]) => example === 'ellipse' ? (Math.atan2((265 - py) / (62 * 3), (px - 440) / (62 * 4)) * 180 / Math.PI + 360) % 360 : (px - 440) / 62}>{marker}</GraphHandle>;
    return <g key={name}>{marker}</g>;
  };
  const theta = value * Math.PI / 180;
  const moving: Point = [4 * Math.cos(theta), 3 * Math.sin(theta)];
  const functionPoint: Point = [value, 3 - value * value / 2];
  const lineY = (x: number) => 3 + value * value / 2 - value * x;
  // Orthographic projection of a cube and its exact horizontal section.
  const spatial = ([x, y, z]: [number, number, number]): Point => {
    const angle = (rotation + 32) * Math.PI / 180;
    const u = (x - 1) * Math.cos(angle) - (y - 1) * Math.sin(angle);
    const v = (x - 1) * Math.sin(angle) + (y - 1) * Math.cos(angle);
    return [440 + u * 132, 325 + v * 60 - (z - 0.5) * 130];
  };
  const cube: [number, number, number][] = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0], [0, 0, 2], [2, 0, 2], [2, 2, 2], [0, 2, 2]];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const section: [number, number, number][] = [[0, 0, value], [2, 0, value], [2, 2, value], [0, 2, value]];
  const label = example === 'ellipse' ? '椭圆与焦点，动点 P 和两焦点构成三角形' : example === 'function' ? '抛物线上的动点与经过该点的切线' : '正方体和平行于底面的正方形截面';
  return (
    <svg viewBox="0 0 880 530" className={styles.graph} role={onValueChange && example !== 'space' ? 'group' : 'img'} aria-labelledby={`${graphId}-title`}>
      <title id={`${graphId}-title`}>{label}</title>
      <defs>
        <pattern id={`${graphId}-grid`} width="62" height="62" patternUnits="userSpaceOnUse" x="440" y="265"><path d="M 62 0 L 0 0 0 62" fill="none" stroke={workbench ? 'var(--demo-grid)' : '#b9c9c1'} strokeOpacity={workbench ? '.6' : '.09'} strokeWidth="1" />{workbench && <path d="M15.5 0V62M31 0V62M46.5 0V62M0 15.5H62M0 31H62M0 46.5H62" stroke="var(--demo-grid)" strokeOpacity=".2" strokeWidth=".7" />}</pattern>
        <clipPath id={`${graphId}-clip`}><rect x="34" y="28" width="812" height="474" /></clipPath>
      </defs>
      {/* Fill the canvas margins while preserving the geometry's aspect ratio. */}
      {showGrid && <rect x={workbench ? -880 : 0} y={workbench ? -530 : 0} width={workbench ? 2640 : 880} height={workbench ? 1590 : 530} fill={`url(#${graphId}-grid)`} />}
      {example !== 'space' && showAxes && <g className={styles.graphAxes}>
        <path d="M34 265H846M440 28V502" stroke={subdued} strokeOpacity=".6" strokeWidth="1" />
        <path d="m840 261 6 4-6 4M436 34l4-6 4 6" fill="none" stroke={subdued} strokeWidth="1.2" />
        {[-4, -2, 2, 4, 6].map(x => <text key={`x${x}`} x={440 + x * 62} y={288} textAnchor="middle" fill={subdued}>{x}</text>)}
        {[-2, 2, 4].map(y => <text key={`y${y}`} x={425} y={270 - y * 62} textAnchor="end" fill={subdued}>{y}</text>)}
        <text x="452" y="287" fill={subdued}>O</text><text x="830" y="248" fill={subdued}>x</text><text x="454" y="43" fill={subdued}>y</text>
      </g>}
      <g clipPath={`url(#${graphId}-clip)`} fontSize="17" fontFamily="inherit">
        {example === 'ellipse' && <>
          {construction >= 3 && <ellipse cx="440" cy="265" rx="248" ry="186" fill="none" stroke={ink} strokeOpacity=".8" strokeWidth="1.7" className={workbench ? styles.drawCurve : undefined} pathLength="1" />}
          {construction >= 4 && <g className={workbench ? styles.previewReveal : undefined}>
            <line x1={440 - focalDistance * 62} x2={440 + focalDistance * 62} y1="265" y2="265" stroke={subdued} strokeWidth="1.5" />
            {dot([-focalDistance, 0], 'F₁', ink, -24, 28)}{dot([focalDistance, 0], 'F₂', ink, 10, 28)}
          </g>}
          {construction >= 5 && <g className={workbench ? styles.previewReveal : undefined}>
            <polygon points={[[-focalDistance, 0], moving, [focalDistance, 0]].map(point => p(point as Point)).join(' ')} fill={accent} fillOpacity=".10" stroke={accent} strokeOpacity=".7" strokeWidth="1.3" />
            <line x1={project(moving)[0]} y1={project(moving)[1]} x2={project(moving)[0]} y2="265" stroke={accent} strokeOpacity=".45" strokeDasharray="4 6" />
            <circle cx={project(moving)[0]} cy={project(moving)[1]} r="12" fill={accent} fillOpacity=".1" />
            {dot(moving, 'P', accent, moving[0] < 0 ? -26 : 14, moving[1] < 0 ? 27 : -15)}
          </g>}
        </>}
        {example === 'function' && <>
          <path d={Array.from({ length: 101 }, (_, i) => { const x = -4 + i * .08; return `${i ? 'L' : 'M'}${p([x, 3 - x * x / 2])}`; }).join(' ')} fill="none" stroke={ink} strokeWidth="1.8" />
          <path d={`M${p([-5, lineY(-5)])}L${p([5, lineY(5)])}`} stroke={accent} strokeWidth="1.6" />
          <path d={`M${p([value, 0])}L${p(functionPoint)}L${p([0, functionPoint[1]])}`} fill="none" stroke={subdued} strokeDasharray="4 6" strokeOpacity=".6" />
          {dot(functionPoint, 'P', accent)}<text x="592" y="444" fill={subdued} fontSize="16">f(x) = 3 − x²/2</text>
        </>}
        {example === 'space' && <>
          <polygon points={[cube[0], cube[1], cube[2], cube[3]].map(c => spatial(c).join(',')).join(' ')} fill="#e7eeeb" fillOpacity=".025" />
          {edges.map(([a, b]) => <line key={`${a}-${b}`} x1={spatial(cube[a])[0]} y1={spatial(cube[a])[1]} x2={spatial(cube[b])[0]} y2={spatial(cube[b])[1]} stroke={ink} strokeOpacity=".65" strokeWidth="1.5" />)}
          <polygon points={section.map(c => spatial(c).join(',')).join(' ')} fill={accent} fillOpacity=".18" stroke={accent} strokeWidth="2" />
          {section.map((c, i) => <circle key={i} cx={spatial(c)[0]} cy={spatial(c)[1]} r="4" fill={accent} />)}
          {cube.slice(0, 4).map((c, i) => <text key={i} x={spatial(c)[0] + 9} y={spatial(c)[1] + 20} fill={subdued} fontSize="15">{['A', 'B', 'C', 'D'][i]}</text>)}
          <text x={spatial(section[1])[0] + 15} y={spatial(section[1])[1] - 12} fill={accent}>h = {value.toFixed(2)}</text>
          <text x="65" y="467" fill={subdued} fontSize="16">α ∥ 底面 ABCD</text>
        </>}
      </g>
    </svg>
  );
}

function useOnScreen() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let intersecting = false;
    const update = () => setActive(intersecting && document.visibilityState === 'visible');
    const observer = new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting && entry.intersectionRatio >= .4; update(); }, { threshold: [0, .4] });
    observer.observe(element);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);
  return { ref, active };
}

const demoPrompt = '画一个椭圆，标出焦点，让动点 P 与两焦点围成三角形，展示面积变化。';
// One local playback clock keeps the conversation and construction in sync.
const demoStepStarts = [0, 1200, 2200, 3500, 5000, 6500, 8000, 10000];
const demoTools = [
  { step: 2, title: '读取画板', tool: 'ggb_get_state', detail: '检查当前画板，从空白坐标系开始。' },
  { step: 3, title: '构建椭圆', tool: 'ggb_apply', detail: '以原点为中心，长半轴 4，短半轴 3。' },
  { step: 4, title: '标出两个焦点', tool: 'ggb_apply', detail: '计算焦距，标出 F₁、F₂。' },
  { step: 5, title: '连接动点与焦点', tool: 'ggb_apply', detail: '让 P 位于椭圆上，构建三角形 PF₁F₂。' },
  { step: 6, title: '添加滑块与面积', tool: 'ggb_apply', detail: '用 θ 控制动点，实时计算三角形面积。' },
];

export function HeroDemo() {
  const [step, setStep] = useState(0);
  const [activityOpen, setActivityOpen] = useState(true);
  const [angle, setAngle] = useState(48);
  const [playing, setPlaying] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState('');
  const [showAxes, setShowAxes] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const conversationId = useId();
  const compact = useSyncExternalStore(subscribeCompact, readCompact, serverCompact);
  const reducedMotion = useSyncExternalStore(subscribeMotion, readReducedMotion, serverReducedMotion);
  const { ref, active } = useOnScreen();
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const motionMedia = window.matchMedia(motionQuery);
    const compactMedia = window.matchMedia('(max-width: 640px)');
    const motion = { progress: 0 };
    let disposed = false;
    let targetProgress = 0;
    let followProgress: ((progress: number) => void) | undefined;
    let pauseFollow = () => {};
    let revertFollow = () => {};
    const render = () => {
      stage.style.setProperty('--workbench-rotate', `${(compactMedia.matches ? 1.5 : 4) * motion.progress}deg`);
      stage.style.setProperty('--workbench-scale', `${1 - (compactMedia.matches ? .005 : .015) * motion.progress}`);
    };
    const update = (immediate = false) => {
      const rect = stage.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const stageTop = rect.top + window.scrollY;
      const start = Math.max(0, stageTop - viewportHeight * .65);
      const end = stageTop + Math.min(rect.height * .2, viewportHeight * .15);
      const progress = Math.min(1, Math.max(0, (window.scrollY - start) / (end - start)));
      const disabled = motionMedia.matches || document.fullscreenElement === ref.current;
      const next = disabled ? 0 : progress * progress * (3 - 2 * progress);
      if (immediate || disabled || !followProgress) {
        pauseFollow();
        motion.progress = targetProgress = next;
        render();
      } else if (next !== targetProgress) {
        targetProgress = next;
        followProgress(next);
      }
    };
    const onScroll = () => update();
    const reset = () => update(true);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', reset);
    document.addEventListener('fullscreenchange', reset);
    motionMedia.addEventListener('change', reset);
    reset();
    void import('gsap').then(({ gsap }) => {
      if (disposed) return;
      const context = gsap.context(() => {
        // Reuse one tween: scroll retargets it without queuing animations.
        // A short ease-out leaves a visible settle after the wheel stops.
        const follow = gsap.quickTo(motion, 'progress', { duration: .65, ease: 'power2.out', onUpdate: render });
        followProgress = follow;
        pauseFollow = () => { follow.tween.pause(); };
      }, stage);
      revertFollow = () => context.revert();
    });
    return () => {
      disposed = true;
      revertFollow();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', reset);
      document.removeEventListener('fullscreenchange', reset);
      motionMedia.removeEventListener('change', reset);
      stage.style.removeProperty('--workbench-rotate');
      stage.style.removeProperty('--workbench-scale');
    };
  }, [ref]);
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, [ref]);
  const elapsed = useRef(0);
  const stepRef = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const followingAnimation = useRef(false);
  const cancelMessageFollow = useRef(() => {});
  const interruptMessageFollow = () => {
    cancelMessageFollow.current();
    followMessages.current = false;
  };
  const visibleStep = reducedMotion ? 7 : step;
  useEffect(() => {
    const messages = messagesRef.current;
    if (!messages || !followMessages.current) return;
    const start = messages.scrollTop;
    const target = Math.max(0, messages.scrollHeight - messages.clientHeight);
    if (reducedMotion || Math.abs(target - start) < 1) {
      messages.scrollTop = target;
      return;
    }
    let frame = 0;
    let started: number | undefined;
    followingAnimation.current = true;
    const cancel = () => {
      cancelAnimationFrame(frame);
      followingAnimation.current = false;
    };
    cancelMessageFollow.current = cancel;
    const tick = (now: number) => {
      started ??= now;
      const progress = Math.min(1, (now - started) / 240);
      messages.scrollTop = start + (target - start) * (1 - (1 - progress) ** 3);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else followingAnimation.current = false;
    };
    frame = requestAnimationFrame(tick);
    return cancel;
  }, [visibleStep, activityOpen, reducedMotion, conversationOpen]);
  useEffect(() => {
    if (!active || reducedMotion !== false || !playing) return;
    let frame = 0;
    let last = 0;
    let rendered = 0;
    const tick = (now: number) => {
      if (!last) last = now;
      const delta = Math.min(now - last, 64);
      last = now;
      elapsed.current += delta;
      rendered += delta;
      if (stepRef.current < 7) {
        const next = demoStepStarts.findLastIndex(start => elapsed.current >= start);
        if (next !== stepRef.current) { stepRef.current = next; setStep(next); rendered = 0; }
      } else if (rendered >= 1000 / 30) {
        const increment = rendered * .009;
        setAngle(previous => (previous + increment) % 360);
        rendered = 0;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, playing, reducedMotion]);
  const updateAngle = (value: number) => { setPlaying(false); setAngle(value); };
  const sendDemoPrompt = () => { elapsed.current = demoStepStarts[1]; stepRef.current = 1; setStep(1); setPlaying(true); };
  const replay = () => { elapsed.current = 0; stepRef.current = 0; followMessages.current = true; setActivityOpen(true); setAngle(48); setStep(0); setPlaying(true); };
  const area = focalDistance * Math.abs(3 * Math.sin(angle * Math.PI / 180));
  const currentStep = visibleStep === 0 ? '准备发送题目' : visibleStep === 1 ? '正在分析题目…' : visibleStep === 7 ? '构建完成 · 可拖动探索' : `${demoTools[visibleStep - 2].title}…`;
  return (
    <div ref={stageRef} className={styles.workbenchStage}>
    <div ref={ref} className={styles.workbench} data-sidebar-open={sidebarOpen} data-demo-step={visibleStep} data-animating={active && playing && !reducedMotion}>
      <div className={styles.previewWorkspace}>
        <aside className={styles.previewSidebar} aria-label="演示课件侧栏" inert={!sidebarOpen}>
          <div className={styles.previewBrand}><span className={styles.previewMark}>M</span><strong>MathMover</strong><button type="button" onClick={() => setSidebarOpen(false)} aria-label="收起演示侧栏"><PanelLeftClose size={15} /></button></div>
          <button type="button" onClick={replay} className={styles.previewNew} aria-label="重新开始课件演示"><Plus size={15} aria-hidden="true" />新建课件</button>
          <label className={styles.previewSearch}><Search size={14} aria-hidden="true" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索课件标题" aria-label="搜索演示课件" /></label>
          <span className={styles.previewListLabel}>最近课件</span><span className={styles.previewDay}>今天</span>
          {'椭圆与动点'.includes(search.trim()) ? <button type="button" className={styles.previewCourseware} onClick={replay}>椭圆与动点<RotateCcw size={13} aria-hidden="true" /></button> : <p className={styles.previewNoResults}>没有匹配的课件</p>}
          <div className={styles.previewSidebarFooter}><div className={styles.previewSettingsEntry}><Settings2 size={15} aria-hidden="true" /><span>设置</span></div></div>
        </aside>
        <div className={styles.previewMain}>
          <div className={styles.previewBoard}>
            <div className={styles.previewToolbar}>
              {!sidebarOpen && <button type="button" className={styles.previewExpand} onClick={() => setSidebarOpen(true)} aria-label="展开演示侧栏"><PanelLeftOpen size={16} /></button>}
              <ControlDeck title="椭圆与动点" showAxes={showAxes} showGrid={showGrid} settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen(previous => !previous)} isFullscreen={fullscreen} onToggleAxes={() => setShowAxes(previous => !previous)} onToggleGrid={() => setShowGrid(previous => !previous)} onResetView={() => { updateAngle(48); setShowAxes(true); setShowGrid(true); }} onToggleFullscreen={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void ref.current?.requestFullscreen().catch(() => {}); }} />
            </div>
            {settingsOpen && <div className={styles.previewSettings} role="group" aria-label="演示画板设置"><label><input type="checkbox" checked={showAxes} onChange={event => setShowAxes(event.target.checked)} />坐标轴</label><label><input type="checkbox" checked={showGrid} onChange={event => setShowGrid(event.target.checked)} />网格</label><button type="button" onClick={() => setSettingsOpen(false)}>完成</button></div>}
            <div className={styles.previewCanvas}>
              <Graph example="ellipse" value={angle} construction={visibleStep} workbench showAxes={showAxes} showGrid={showGrid} onValueChange={visibleStep >= 7 ? updateAngle : undefined} />
              {visibleStep >= 6 && <div className={`${styles.canvasParameter} ${styles.previewReveal}`}>
                <div><label htmlFor="hero-angle">θ = {Math.round(angle)}°</label><button type="button" disabled={visibleStep < 7 || reducedMotion} aria-label={playing && !reducedMotion ? '暂停动点动画' : '播放动点动画'} onClick={() => setPlaying(previous => !previous)} title={reducedMotion ? '已遵循系统减少动态效果设置，可拖动滑块探索' : undefined}>{playing && !reducedMotion ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}</button></div>
                <input id="hero-angle" type="range" min="0" max="360" step=".1" value={angle} disabled={visibleStep < 7} onChange={event => updateAngle(Number(event.target.value))} aria-label="动点角度" aria-valuetext={`${Math.round(angle)} 度`} />
              </div>}
              {visibleStep >= 3 && <div className={styles.canvasFormula}>x²/16 + y²/9 = 1{visibleStep >= 6 && <span>△PF₁F₂ 面积 = {area.toFixed(2)}</span>}</div>}
            </div>
          </div>
          <section className={styles.previewChat} aria-label="构建对话演示" data-expanded={conversationOpen}>
            <p className={styles.previewMobilePrompt}>{demoPrompt}</p>
            <div className={styles.previewChatHeader}><strong>对话</strong><span className={styles.previewCurrentStep} aria-live={compact ? 'polite' : 'off'}><span className={styles.previewStatusDot} data-running={visibleStep > 0 && visibleStep < 7} /><span>{currentStep}</span></span><div className={styles.previewPlayback}><span>交互演示</span><button type="button" onClick={() => setPlaying(previous => !previous)} disabled={reducedMotion} aria-label={playing ? '暂停演示' : '继续演示'} title={playing ? '暂停演示' : '继续演示'} className={styles.previewReplay}>{playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}</button><button type="button" onClick={replay} aria-label="重新播放构建演示" title="重播演示" className={styles.previewReplay}><RotateCcw size={13} aria-hidden="true" /></button></div><button type="button" className={styles.previewConversationToggle} aria-label={conversationOpen ? '收起完整演示对话' : '展开完整演示对话'} aria-expanded={conversationOpen} aria-controls={conversationId} onClick={() => setConversationOpen(previous => !previous)}>过程<ChevronDown size={14} aria-hidden="true" /></button></div>
            <div id={conversationId} className={styles.previewConversation} aria-hidden={compact && !conversationOpen ? true : undefined} inert={compact && !conversationOpen}><div className={styles.previewConversationInner}>
            <div ref={messagesRef} className={styles.previewMessages}
              onWheel={interruptMessageFollow} onPointerDown={interruptMessageFollow}
              onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interruptMessageFollow(); }}
              onScroll={event => { if (followingAnimation.current) return; const element = event.currentTarget; followMessages.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40; }}>
              {visibleStep >= 1 && <p className={`${styles.previewUser} ${styles.previewReveal}`}>{demoPrompt}</p>}
              {visibleStep >= 1 && <details className={styles.previewActivity} open={activityOpen} onToggle={event => setActivityOpen(event.currentTarget.open)}>
                <summary><ChevronRight size={12} aria-hidden="true" /><span className={styles.previewStatusDot} data-running={visibleStep < 7} /><span aria-live="polite">{visibleStep === 1 ? '正在分析题目…' : visibleStep === 7 ? '本轮结束 · 5 次工具调用' : `${demoTools[visibleStep - 2].title}…`}</span></summary>
                <ol className={styles.previewTools}>{demoTools.filter(tool => visibleStep >= tool.step).map(tool => <li key={tool.step} className={styles.previewReveal} data-running={visibleStep === tool.step}>
                  <div>{visibleStep > tool.step ? <Check size={12} aria-hidden="true" /> : <span className={styles.previewStatusDot} data-running="true" />}<span>{tool.title}</span><code>{tool.tool}</code></div>
                  <p>{tool.detail}</p>
                </li>)}</ol>
              </details>}
              {visibleStep === 7 && <div className={`${styles.previewAnswer} ${styles.previewReveal}`}><p>椭圆、焦点和三角形已构建完成。</p><p>现在拖动 θ，观察面积变化。P 到达最高点或最低点时，面积最大。</p></div>}
            </div>
            <div className={styles.previewComposer} data-drafting={visibleStep === 0}><span>{visibleStep === 0 ? demoPrompt : '输入题目，或上传题目截图…'}</span><span><ImagePlus size={15} aria-hidden="true" />{visibleStep > 0 && visibleStep < 7 ? <button type="button" className={styles.previewSend} data-state="stop" aria-label="停止演示" title="停止演示" onClick={() => setPlaying(false)} disabled={!playing}><Square size={14} fill="currentColor" aria-hidden="true" /></button> : <button type="button" className={styles.previewSend} aria-label="发送演示题目" title="发送演示题目" onClick={sendDemoPrompt} disabled={visibleStep !== 0}><ArrowUp size={18} strokeWidth={2.25} aria-hidden="true" /></button>}</span></div>
            </div></div>
          </section>
        </div>
      </div>
    </div>
    </div>
  );
}

const examples: { id: Example; title: string; heading: string; description: string; parameter: string; min: number; max: number; step: number; initial: number }[] = [
  { id: 'ellipse', title: '解析几何', heading: '动点与三角形面积', description: '沿椭圆移动点 P，观察它与两焦点围成的三角形。', parameter: '动点角度 θ', min: 0, max: 360, step: 1, initial: 56 },
  { id: 'function', title: '函数与变化', heading: '切线与瞬时斜率', description: '拖动曲线上的点 P，观察切线的方向与斜率。', parameter: '横坐标 x', min: -2.8, max: 2.8, step: .01, initial: 1.25 },
  { id: 'space', title: '立体几何', heading: '平行截面与空间关系', description: '移动截面、旋转视角，探索平面与正方体的位置关系。', parameter: '截面高度 h', min: .05, max: 1.95, step: .01, initial: 1.1 },
];

export function ExampleGallery() {
  const [selected, setSelected] = useState<Example>('ellipse');
  const [values, setValues] = useState<Record<Example, number>>({ ellipse: 56, function: 1.25, space: 1.1 });
  const [rotation, setRotation] = useState(0);
  const [navFits, setNavFits] = useState(true);
  const galleryRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const panelsRef = useRef<HTMLDivElement>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const pageToRef = useRef<((index: number) => boolean) | null>(null);
  const activeIndex = useRef(0);

  useEffect(() => {
    const nav = navRef.current;
    const panels = panelsRef.current;
    if (!nav || !panels) return;
    const measure = () => {
      const top = Number.parseFloat(getComputedStyle(nav).top) || 0;
      galleryRef.current?.style.setProperty('--case-sidebar-height', `${nav.offsetHeight}px`);
      setNavFits(nav.offsetHeight + top + 24 <= window.innerHeight);
      refreshRef.current?.();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    Array.from(panels.children).forEach(panel => observer.observe(panel));
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};
    void Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('gsap/ScrollToPlugin')]).then(([{ gsap }, { ScrollTrigger }, { ScrollToPlugin }]) => {
      const gallery = galleryRef.current;
      const panels = panelsRef.current;
      if (cancelled || !gallery || !panels) return;
      gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
      let stops: number[] = [];
      let pagingFits = false;
      let destination: number | null = null;
      const sync = (scroll: number) => {
        if (!stops.length) return;
        const next = stops.reduce((nearest, stop, index) => Math.abs(stop - scroll) < Math.abs(stops[nearest] - scroll) ? index : nearest, 0);
        const current = activeIndex.current;
        if (current === next) return;
        // Highlight the panel that is arriving, rather than the requested
        // destination before it has moved. A small dead band also prevents
        // flicker when scrolling back and forth around the midpoint.
        const arrivalDistance = Math.min(Math.abs(stops[next] - stops[current]) * .35, window.innerHeight * .3);
        if (Math.abs(stops[next] - scroll) > arrivalDistance) return;
        activeIndex.current = next;
        setSelected(examples[next].id);
      };
      const media = gsap.matchMedia();
      media.add({ always: 'all', paging: '(min-width: 901px) and (min-height: 600px) and (prefers-reduced-motion: no-preference)' }, context => {
        const scrollSurfaces = [document.documentElement, document.body];
        const scrollBehaviors = scrollSurfaces.map(element => element.style.scrollBehavior);
        const restoreScrollBehavior = () => scrollSurfaces.forEach((element, index) => { element.style.scrollBehavior = scrollBehaviors[index]; });
        let pageTween: ReturnType<typeof gsap.to> | null = null;
        const gesture = createCaseWheelGesture();
        let pageDirection = 0;
        let queuedPage: number | null = null;
        const cancelPage = () => {
          pageTween?.kill();
          pageTween = null;
          destination = null;
          queuedPage = null;
          pageDirection = 0;
          gesture.reset();
          restoreScrollBehavior();
        };
        const moveTo = (index: number) => {
          if (!pagingFits || index < 0 || index >= stops.length) return false;
          pageTween?.kill();
          queuedPage = null;
          pageDirection = Math.sign(stops[index] - window.scrollY);
          destination = index;
          sync(window.scrollY);
          scrollSurfaces.forEach(element => { element.style.scrollBehavior = 'auto'; });
          pageTween = gsap.to(window, {
            scrollTo: { y: stops[index], autoKill: true },
            duration: .48,
            ease: 'power2.out',
            onComplete: () => {
              pageTween = null;
              destination = null;
              restoreScrollBehavior();
              sync(window.scrollY);
              const next = queuedPage;
              queuedPage = null;
              if (next !== null) moveTo(next);
            },
            onInterrupt: () => { pageTween = null; destination = null; queuedPage = null; restoreScrollBehavior(); },
          });
          return true;
        };
        const trigger = ScrollTrigger.create({
          trigger: gallery,
          start: 'top bottom',
          end: 'bottom top',
          onUpdate: self => sync(self.scroll()),
          onRefresh: self => {
            cancelPage();
            const bounds = Array.from(panels.children, panel => panel.getBoundingClientRect());
            const inset = Number.parseFloat(getComputedStyle(panels.firstElementChild!).scrollMarginTop) || 112;
            stops = bounds.map(rect => rect.top + self.scroll() - inset);
            pagingFits = !!context.conditions?.paging && !!navRef.current && navRef.current.offsetHeight + inset + 24 <= window.innerHeight
              && bounds.every(rect => rect.height <= window.innerHeight - inset);
            sync(self.scroll());
          },
        });
        const nextPage = (direction: number) => direction > 0
          ? stops.findIndex(stop => stop > window.scrollY + 8)
          : stops.findLastIndex(stop => stop < window.scrollY - 8);
        const onWheel = (event: WheelEvent) => {
          if (!pagingFits || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
          if (event.target instanceof Element && event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
          const scroll = window.scrollY;
          if (!pageTween && (scroll < Math.floor(stops[0] - 180) || scroll > Math.ceil(stops[stops.length - 1] + 180))) { gesture.reset(); return; }
          const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
          const intent = gesture.read(delta, performance.now());
          // Let a fresh outward gesture leave the gallery, while absorbing the last page's inertia.
          if (!pageTween && nextPage(Math.sign(delta)) < 0 && (!intent.consumed || intent.direction)) { gesture.reset(); return; }
          event.preventDefault();
          if (!intent.direction) return;
          if (pageTween && intent.direction === pageDirection && destination !== null) {
            // Keep one deliberate follow-up gesture; never queue the inertial tail.
            const next = destination + intent.direction;
            if (next >= 0 && next < stops.length) queuedPage = next;
          } else {
            // Include the departure stop when reversing in the first few pixels.
            const next = pageTween
              ? intent.direction > 0 ? stops.findIndex(stop => stop >= scroll - 1) : stops.findLastIndex(stop => stop <= scroll + 1)
              : nextPage(intent.direction);
            moveTo(next);
          }
        };
        const cancelForKey = (event: KeyboardEvent) => {
          if (['Escape', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) cancelPage();
        };
        window.addEventListener('pointerdown', cancelPage);
        window.addEventListener('keydown', cancelForKey);
        if (context.conditions?.paging) window.addEventListener('wheel', onWheel, { passive: false });
        pageToRef.current = index => { gesture.reset(); return moveTo(index); };
        refreshRef.current = () => trigger.refresh();
        return () => {
          cancelPage();
          window.removeEventListener('wheel', onWheel);
          window.removeEventListener('pointerdown', cancelPage);
          window.removeEventListener('keydown', cancelForKey);
          refreshRef.current = null;
          pageToRef.current = null;
        };
      }, gallery);
      dispose = () => { refreshRef.current = null; pageToRef.current = null; media.revert(); };
      void document.fonts.ready.then(() => { if (!cancelled) refreshRef.current?.(); });
    }).catch(() => { /* Native anchors and every demonstration remain usable. */ });
    return () => { cancelled = true; dispose(); };
  }, []);

  return (
    <div ref={galleryRef} className={styles.gallery} data-active-example={selected} data-nav-fits={navFits}>
      <aside ref={navRef} className={styles.caseSidebar}>
        <div className={styles.caseIntro}>
          <h2 id="examples-title">换一个角度，<br />看懂一个问题。</h2>
          <p>移动一个点，改变一个参数。<br />让图形给出另一种解释。</p>
        </div>
      <nav className={styles.caseNav} aria-label="数学交互案例">
        {examples.map((example, index) => <a key={example.id} id={`example-link-${example.id}`} href={`#example-panel-${example.id}`} className={styles.caseCard} aria-current={selected === example.id ? 'location' : undefined} onClick={event => {
          if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (!pageToRef.current?.(index)) document.getElementById(`example-panel-${example.id}`)?.scrollIntoView({ behavior: readReducedMotion() ? 'instant' : 'smooth', block: 'start' });
          const hash = `#example-panel-${example.id}`;
          if (window.location.hash !== hash) window.history.pushState(window.history.state, '', hash);
        }} onKeyDown={event => {
          const next = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? (index + 1) % examples.length : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? (index + examples.length - 1) % examples.length : event.key === 'Home' ? 0 : event.key === 'End' ? examples.length - 1 : null;
          if (next !== null) { event.preventDefault(); document.getElementById(`example-link-${examples[next].id}`)?.focus({ preventScroll: true }); }
        }}><span className={styles.caseCardTitle}><span><span className={styles.caseIndex} aria-hidden="true">0{index + 1}</span>{example.title}</span><ArrowRight size={14} aria-hidden="true" /></span><strong>{example.heading}</strong><span className={styles.caseDescription}>{example.description}</span></a>)}
        <p className={styles.caseNavHint}><ArrowDown size={12} aria-hidden="true" />滚动切换案例，也可点击选择</p>
      </nav>
      </aside>
      <div ref={panelsRef} className={styles.galleryPanels}>
        {examples.map(current => {
          const value = values[current.id];
          const parameterId = `example-parameter-${current.id}`;
          return <section key={current.id} id={`example-panel-${current.id}`} aria-labelledby={`example-link-${current.id}`} data-active={selected === current.id} className={styles.examplePanel}>
            <div className={styles.caseMobileIntro}><h3>{current.heading}</h3><p>{current.description}</p></div>
            <div className={styles.exampleVisual}>
              <div className={styles.exampleVisualHeader}><span>{current.heading}<span>{current.title}</span></span><div className={styles.exampleActions}>{current.id === 'space' && <button type="button" aria-label="旋转视角" title="旋转视角" onClick={() => setRotation(previous => previous + 30)} className={styles.rotateButton}><RotateCw size={14} aria-hidden="true" /><span>旋转视角</span></button>}<button type="button" className={styles.rotateButton} aria-label={`恢复${current.title}案例初始状态`} title="恢复初始" onClick={() => { setValues(previous => ({ ...previous, [current.id]: current.initial })); if (current.id === 'space') setRotation(0); }}><RotateCcw size={14} aria-hidden="true" /><span>恢复初始</span></button></div></div>
              <Graph example={current.id} value={value} rotation={rotation} workbench onValueChange={next => setValues(previous => ({ ...previous, [current.id]: next }))} />
              <div className={styles.exampleControls}><label htmlFor={parameterId}>{current.parameter}</label><input id={parameterId} type="range" min={current.min} max={current.max} step={current.step} value={value} onChange={event => { const next = Number(event.target.value); setValues(previous => ({ ...previous, [current.id]: next })); }} aria-valuetext={`${value.toFixed(current.id === 'ellipse' ? 0 : 2)}${current.id === 'ellipse' ? ' 度' : ''}`} /><output htmlFor={parameterId} aria-live="off">{current.id === 'ellipse' ? `${value.toFixed(0)}°` : value.toFixed(2)}</output></div>
              <div className={styles.caseFooter}>
                <div className={styles.exampleFact}><span>{current.id === 'ellipse' ? '三角形 PF₁F₂ 的面积' : current.id === 'function' ? '点 P 处的切线斜率' : '截面面积'}</span><strong>{current.id === 'ellipse' ? (focalDistance * Math.abs(3 * Math.sin(value * Math.PI / 180))).toFixed(2) : current.id === 'function' ? (Math.abs(value) < .005 ? '0.00' : (-value).toFixed(2)) : '4'}<span>{current.id !== 'function' ? ' 平方单位' : ''}</span></strong></div>
                <p className={styles.exampleNote}><MousePointer2 size={13} aria-hidden="true" />{current.id === 'space' ? '拖动滑块，观察变化' : '拖动点 P 或滑块，观察变化'}</p>
              </div>
            </div>
          </section>;
        })}
      </div>
    </div>
  );
}
