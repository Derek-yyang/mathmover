/**
 * 3D 视图的「重置视图居中」。
 *
 * GeoGebra 没有重置 3D 相机的公开 API，实测把每条看似可行的路都堵死了：
 *  - `setPerspective('T')` 已处在该视角时是空操作（切 G 再切 T 也不动——相机状态跨视角切换保留）；
 *  - `SetViewDirection(<向量>)` 的方向→角度换算带一个隐性的滚转自由度：同一个目标向量
 *    从不同起始态会落到 (20,-60) 或它的镜像 (-20,120)（6 组实测 3 组镜像），且**不可预测**；
 *  - `ZoomIn` 是相对缩放，读不到绝对值；负因子会写出负 scale、把画面拉爆
 *    （这正是早期那次「点重置整个崩掉」的元凶，不是 CenterView）；
 *  - `CenterView` 是 2D 命令，在 3D 下语义不明。
 *
 * 相机状态其实就存在构造 XML 的 `<euclidianView3D><coordSystem .../></euclidianView3D>` 里
 * （xZero/yZero/zZero 平移、scale 缩放、xAngle/zAngle 朝向）。所以走 XML：
 * 取**当前**构造的 XML、只把这一块换成标准视角、再 setXML 写回——
 * 对象集来自当前 XML 所以一个不丢，视角、中心、缩放一起精确落回标准值。
 *
 * 实测（headless Chrome + 本地 5.4.931.2）：5 组乱视角（旋转+缩放+平移）精确复位、
 * 对象与滑块值不动、2D 视图与更新事件零影响；补上 `refreshViews()` 后渲染结果与
 * 初始标准画面**逐字节相同**。
 */

/**
 * 标准 3D 视角的坐标系统。
 *
 * zZero 取 **-0.5**：让那块灰色「底板」落在画面**中间偏下一点**。
 *
 * 板是贴 z=0 画的，相机中心 z 决定它在屏幕上的高低——实测（998×648 画布、scale=50）
 * z=0 时板的重心正好落在画布中心（324 vs 324），z=-1.5（GeoGebra 出厂值）时低 70px（11%）。
 * 观感上要留一点"头顶空间"（图形坐在地上、z 轴朝上），但出厂那 11% 又太偏——取 −0.5
 * ≈ 偏下 23px（3.5%）。
 *
 * ⚠ 这个偏移是**世界单位 × 当前缩放**，不是画布比例：agent 把视图放大 3 倍后，同一 −0.5
 * 会变成偏下 70px（11%）。要"任何缩放下看起来都一样"，得在稿子落地后按屏幕比例算 z
 *（`zZero = -比例 × 画布高px / scale`）——尚未做，等真觉得需要再说。
 *
 * 板的位置本身是 GeoGebra 内部的（没有 API/命令可调），能动的只有相机。
 */
export const STANDARD_3D_VIEW = {
  xZero: 0,
  yZero: 0,
  zZero: -0.5,
  scale: 50,
  xAngle: 20,
  zAngle: -60,
} as const;

const BLOCK = /<euclidianView3D>[\s\S]*?<\/euclidianView3D>/;
const COORD_SYSTEM = /<coordSystem([^>]*)\/?>/;
const ATTRIBUTE = /(\w+)="([^"]*)"/g;

function readAttribute(attrs: string, name: string): string | null {
  for (const match of attrs.matchAll(ATTRIBUTE)) {
    if (match[1] === name) return match[2];
  }
  return null;
}

interface ResetViewApi {
  getXML?: () => string;
  setXML?: (xml: string) => void;
  refreshViews?: () => void;
}

/** 3D 相机（`<coordSystem>` 的语义字段）——重置会把六个字段一起落回标准值。 */
export interface Camera3D {
  xZero: number;
  yZero: number;
  zZero: number;
  scale: number;
  xAngle: number;
  zAngle: number;
}

/** 从构造 XML 读 3D 相机；读不到（没有 3D 块或字段不全）返回 null。 */
export function read3DCamera(xml: string): Camera3D | null {
  const block = typeof xml === 'string' ? BLOCK.exec(xml) : null;
  const coordSystem = block ? COORD_SYSTEM.exec(block[0]) : null;
  if (!coordSystem) return null;
  const value = (name: string) => {
    const raw = readAttribute(coordSystem[1], name);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const fields = {
    xZero: value('xZero'), yZero: value('yZero'), zZero: value('zZero'),
    scale: value('scale'), xAngle: value('xAngle'), zAngle: value('zAngle'),
  };
  if (Object.values(fields).some((v) => v === null)) return null;
  return fields as Camera3D;
}

/** 用给定值替换 3D 相机（scale 缺省沿用当前值；坏值回落到标准缩放）。 */
function patch3DCamera(xml: string, camera: Partial<Camera3D>): string | null {
  if (typeof xml !== 'string' || !xml) return null;
  const block = BLOCK.exec(xml);
  if (!block) return null;
  const coordSystem = COORD_SYSTEM.exec(block[0]);
  if (!coordSystem) return null;

  const read = (name: string) => {
    const raw = readAttribute(coordSystem[1], name);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const scale = camera.scale ?? read('scale');
  const next = {
    xZero: camera.xZero ?? read('xZero'),
    yZero: camera.yZero ?? read('yZero'),
    zZero: camera.zZero ?? read('zZero'),
    // 读不到或不是正数（曾被负因子 ZoomIn(-10) 写坏过）就回落到标准缩放：重置顺带修好坏状态
    scale: Number.isFinite(scale) && scale !== null && scale > 0 ? scale : STANDARD_3D_VIEW.scale,
    xAngle: camera.xAngle ?? read('xAngle'),
    zAngle: camera.zAngle ?? read('zAngle'),
  };
  if (Object.values(next).some((v) => v === null)) return null;

  const coord = `<coordSystem xZero="${next.xZero}" yZero="${next.yZero}" zZero="${next.zZero}"`
    + ` scale="${next.scale}" xAngle="${next.xAngle}" zAngle="${next.zAngle}"/>`;
  // 用函数式替换：补丁串里的 `$` 不会被当成替换模式
  const patchedBlock = block[0].replace(coordSystem[0], () => coord);
  return xml.replace(block[0], () => patchedBlock);
}

/**
 * 把 3D 视角换成标准视角（朝向、中心、缩放一起），其余（对象、2D 视图、设置块）原样保留。
 *
 * @returns 打补丁后的 XML；没有 3D 视图块（纯 2D 构造）时返回 null。
 */
export function patchStandard3DView(xml: string): string | null {
  return patch3DCamera(xml, STANDARD_3D_VIEW);
}

interface FrameClock {
  now: () => number;
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
}

export interface ResetViewOptions {
  /** 用户偏好减少动态效果时一次到位 */
  reducedMotion?: boolean;
  /** 基准时长（轻构造走的时长），与 2D 居中同一量级 */
  durationMs?: number;
  /**
   * 时长上限。逐帧只能整份 setXML，帧成本随构造规模涨（实测真实画板：27 个对象 16.7ms、
   * 80 个 28ms、180 个 66ms）——同样 300ms，帧越贵帧数越少、每帧跨得越大，看起来就越顿。
   * 于是把时长按实测帧成本等比拉长（封顶在此）：用一点时间换更细的采样。
   */
  maxDurationMs?: number;
  /** 「一帧本该多贵」的基准（实测 60fps≈16.7ms，取略低的值让中等构造也能受益） */
  nominalFrameMs?: number;
  /**
   * 单帧耗时上限。超过就停止逐帧、直接跳到终点：宁可一次到位，也不要卡成幻灯片
   *（每个帧阻塞这么久，主线程已经撑不住了）。
   */
  frameBudgetMs?: number;
  clock?: FrameClock;
}

const defaultClock = (): FrameClock => ({
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (id) => cancelAnimationFrame(id),
});

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * 执行 3D 视图重置（带缓动动画）。
 *
 * 动画是**逐帧补丁**，不是花活：没有别的接口能把 3D 相机连续设过去（视图-only 的 setXML
 * 会把对象删光，evalXML 又不吃视图设置）。缓动曲线与 2D 居中一致（四阶缓出）；
 * 时长随实测帧成本自适应（见 maxDurationMs），重构造则退化成一次到位（见 frameBudgetMs）。
 *
 * `refreshViews()` 不可省：setXML 之后画面仍停在旧相机上（实测不重绘则像素完全不变）。
 *
 * @returns 取消函数；没执行（无 XML 接口 / 没有 3D 块 / 已经是标准视角）返回 null。
 */
export function resetStandard3DView(api: ResetViewApi, options: ResetViewOptions = {}): (() => void) | null {
  try {
    if (!api.getXML || !api.setXML) return null;
    const xml = api.getXML();
    const target = patchStandard3DView(xml);
    if (!target) return null;

    /** 中间帧：只把插值相机喂进去。 */
    const apply = (patched: string) => {
      api.setXML!(patched);
      api.refreshViews?.();
    };
    /**
     * 收尾：落到精确目标。
     *
     * 已知残留（实测 2026-10-16，未修）：shift+拖动平移会让 GeoGebra 在视图里标上显式的
     * y/z 缩放，若把它当作**紧接在平移后的一次性补丁**收尾，这两个标志会活下来
     * （`yscale/zscale`），画面与全新视图差 1.26% 像素（9648 像素、最大通道差 58）。
     * 动画路径不受影响：收尾补丁天然在第一帧之后 ~300ms，那时标志已自行落下。
     * 清它只有七参 `setCoordSystem` 一条路，但实测要它生效得再等 ~400ms（150ms 都不够），
     * 跳变路径（减少动效 / 大构造）里插这么一段停留会换来一次可见的二次跳动——
     * 权衡后不做，如实记在此处。
     */
    const applyTarget = () => {
      api.setXML!(target);
      api.refreshViews?.();
    };
    const jump = () => { applyTarget(); return null; };

    const start = read3DCamera(xml);
    if (!start) return jump();
    const baseDuration = options.durationMs ?? 300;
    if (options.reducedMotion || baseDuration <= 0) return jump();

    // zAngle 是连续累加量：取与起点最近的同余角，转动才走短边而不是绕一大圈
    const zAngle = STANDARD_3D_VIEW.zAngle + 360 * Math.round((start.zAngle - STANDARD_3D_VIEW.zAngle) / 360);
    const fromCamera: Camera3D = start;
    const toCamera: Camera3D = { ...STANDARD_3D_VIEW, zAngle };
    const alreadyThere = near(start.xAngle, toCamera.xAngle) && near(start.zAngle, toCamera.zAngle)
      && near(start.xZero, toCamera.xZero) && near(start.yZero, toCamera.yZero) && near(start.zZero, toCamera.zZero)
      && near(start.scale, toCamera.scale);
    if (alreadyThere) return null;

    const clock = options.clock ?? defaultClock();
    const budget = options.frameBudgetMs ?? 45;
    const nominal = options.nominalFrameMs ?? 14;
    const maxDuration = Math.max(baseDuration, options.maxDurationMs ?? 520);
    let duration = baseDuration;
    const startedAt = clock.now();
    let frame: number | null = null;
    let cancelled = false;
    let frames = 0;
    // 进度**累积**而不是拿绝对时间算：这样时长可以在飞行中拉长而不会跳变
    let progress = 0;
    let lastTimestamp = startedAt;
    const frameCosts: number[] = [];

    const tick: FrameRequestCallback = (timestamp) => {
      frame = null;
      if (cancelled) return;
      progress = Math.min(1, progress + Math.max(0, timestamp - lastTimestamp) / duration);
      lastTimestamp = timestamp;
      if (progress >= 1) { applyTarget(); return; }
      // 四阶缓出：t=0 即全速、之后一路减速（与 2D 居中同一条曲线）。
      // 试过三阶缓入缓出（两端归零、峰值速度更低），但 300ms 下开头几十毫秒几乎不动，
      // 读起来是「慢热」而不是「顺」——用户实测后选回了这一条。
      const eased = 1 - (1 - progress) ** 4;
      const camera = {
        xZero: fromCamera.xZero + (toCamera.xZero - fromCamera.xZero) * eased,
        yZero: fromCamera.yZero + (toCamera.yZero - fromCamera.yZero) * eased,
        zZero: fromCamera.zZero + (toCamera.zZero - fromCamera.zZero) * eased,
        scale: fromCamera.scale + (toCamera.scale - fromCamera.scale) * eased,
        xAngle: fromCamera.xAngle + (toCamera.xAngle - fromCamera.xAngle) * eased,
        zAngle: fromCamera.zAngle + (toCamera.zAngle - fromCamera.zAngle) * eased,
      };
      const patched = patch3DCamera(xml, camera);
      if (!patched) { applyTarget(); return; }
      const frameStartedAt = clock.now();
      apply(patched);
      frames += 1;
      const cost = clock.now() - frameStartedAt;
      // 首帧不计——它含一次性预热（实测同一构造首帧 80ms、之后中位数 13ms），拿它判会冤杀小构造的动画。
      if (frames > 1) {
        // 这一帧太贵说明主线程已经撑不住，别再逐帧折腾
        if (cost > budget) { applyTarget(); return; }
        // 帧贵 → 同样 300ms 只能切出很少几帧、每帧跨一大步，看着就顿。
        // 按实测成本把时长等比拉长（取前几帧的中位数，避开单帧 GC 抖动），
        // 换更细的采样；轻构造测出来接近基准，时长原样不动。
        frameCosts.push(cost);
        if (duration < maxDuration) {
          const sorted = [...frameCosts].sort((a, b) => a - b);
          const measured = sorted[Math.floor(sorted.length / 2)];
          duration = Math.min(maxDuration, Math.max(duration, duration * measured / nominal));
        }
      }
      frame = clock.request(tick);
    };

    frame = clock.request(tick);
    return () => {
      cancelled = true;
      if (frame !== null) clock.cancel(frame);
      frame = null;
    };
  } catch {
    return null;
  }
}

