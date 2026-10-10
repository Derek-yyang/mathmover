/**
 * 语义校验（判据移植自原 Python `semantic_guard.py`，该文件已随一次性生成管线下线）。
 *
 * 忠实移植的部分：free_param / orphan_slider 的判据与文案（_DEF_RE/_TOKEN_RE 逻辑）、
 * 残留文字对象过滤（stripTextObjects）、类别结构检查的失败文案。
 *
 * 记录在案的实现差异：Python 侧对象 kind 由 ggb_parser 的表达式精化（圆锥/方程
 * 识别等多趟启发式）给出；这里按**定义命令头**分类 + 少量表达式启发（二次项
 * 记 conic-ish）。对 SOP 卡驱动的生成（卡里教的就是 Conic/Function 等构造器）
 * 覆盖一致；对隐式方程写法（e: x^2+y^2=1）的识别是启发式的。
 * 参数级命令校验（ggb_catalog.inspect_line）不在本层——未知命令名记 command_error。
 */

import { classifyLine } from './parse.ts';
import type { Mode } from './types.ts';

export interface SemanticFailure {
  check: string;
  detail: string;
}

export interface SemanticResult {
  ok: boolean;
  validity: number;
  failures: SemanticFailure[];
  summary: string;
}

/** 表达式里的合法名字：数学内置/常量（Python _MATH_FUNCS 同款）。 */
const MATH_FUNCS = new Set([
  'sqrt', 'cbrt', 'abs', 'exp', 'log', 'ln', 'log10', 'log2',
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'cosec',
  'asin', 'acos', 'atan', 'acot', 'arcsin', 'arccos', 'arctan', 'arccot',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'floor', 'ceil', 'round', 'trunc', 'sgn', 'sign',
  'min', 'max', 'mod', 'gcd', 'lcm', 'fact', 'factorial', 'ncr', 'npr',
  'binomial', 'random', 'shuffle', 'if', 'ifundefined', 'sort', 'keepif',
  'zip', 'element', 'length', 'dimension', 'count', 'unique', 'product',
  'sum', 'mean', 'median', 'x', 'y', 'z',
  'pi', 'e', 'phi', 'i', 'undefined', 'true', 'false',
]);

const CONIC_KINDS = new Set(['conic', 'parabola', 'ellipse', 'hyperbola']);

const DEF_RE = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*:?=/;
const TOKEN_RE = /"[^"]*"|\d+\.?\d*(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*/g;

/** 右端里的裸标识符引用（字符串/数字字面量不算；调用头不算）。Python _idents 同款。 */
function idents(rhs: string): string[] {
  const out: string[] = [];
  for (const m of rhs.matchAll(TOKEN_RE)) {
    const tok = m[0];
    if (tok[0] === '"' || /[0-9]/.test(tok[0])) continue;
    if (rhs.slice(m.index! + tok.length).trimStart().startsWith('(')) continue;
    out.push(tok);
  }
  return out;
}

interface MiniObj {
  name: string;
  /** 按命令头的粗分类（+表达式启发） */
  kind: string;
  head: string;
  rhs: string;
  paramCount?: number;
}

const CONIC_HEADS = new Set(['conic', 'parabola', 'ellipse', 'hyperbola']);
const TEXT_HEADS = new Set(['text']);
const SLIDER_HEADS = new Set(['slider']);
const B_HEADS = new Set(['polygon', 'circle', 'arc', 'sector', 'circulararc', 'circularsector', 'rigidpolygon', 'polyline']);
const POINT_HEADS = new Set(['point', 'pointin', 'intersect', 'midpoint', 'center', 'vertex', 'focus', 'extremum']);

function classifyDefs(text: string): { objs: MiniObj[]; defs: { name: string; bound: Set<string>; rhs: string }[] } {
  const objs: MiniObj[] = [];
  const defs: { name: string; bound: Set<string>; rhs: string }[] = [];
  for (const line of text.split('\n')) {
    const m = DEF_RE.exec(line);
    if (!m) continue;
    const name = m[1];
    const params = (m[2] ?? '').trim();
    const rhs = line.slice(m.index + m[0].length);
    const bound = new Set(params.split(',').map((p) => p.trim()).filter(Boolean));
    defs.push({ name, bound, rhs });

    // 命令头 = 右端第一个调用名；f(x)= 形式（带参定义且右端非调用头）记 function
    const call = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(rhs);
    const head = call ? call[1].toLowerCase() : '';
    let kind = 'expression';
    if (call) {
      if (TEXT_HEADS.has(head)) kind = 'text';
      else if (SLIDER_HEADS.has(head)) kind = 'slider';
      else if (CONIC_HEADS.has(head)) kind = head;
      else if (head === 'function' || (params && !call)) kind = 'function';
      else if (B_HEADS.has(head)) kind = head;
      else if (head === 'equation') kind = 'equation';
      else if (POINT_HEADS.has(head)) kind = 'point';
      else kind = 'other';
    } else if (params) {
      kind = 'function'; // f(x) = x^2 形式
    } else if (/[xy]\s*[²^]\s*2|[xy]{2}|x\^2|y\^2/.test(rhs) && rhs.includes('=')) {
      kind = 'conic'; // 隐式二次方程启发（Python 精化的粗对应）
    } else if (/[xy]/.test(rhs) && rhs.includes('=')) {
      kind = 'equation';
    }
    const paramCount = params ? params.split(',').length : undefined;
    objs.push({ name, kind, head, rhs, paramCount });
  }
  return { objs, defs };
}

export interface LineCheck {
  validity: number;
  invalidCount: number;
  total: number;
  unknownCommands: { line: string; head: string }[];
}

/** 行级体检：未知类行计 invalid，命令头不在白名单的记 unknown。 */
export function checkLines(text: string, knownCommandLower: Set<string>): LineCheck {
  let total = 0;
  let invalid = 0;
  const unknownCommands: { line: string; head: string }[] = [];
  for (const raw of text.split('\n')) {
    const { kind } = classifyLine(raw);
    if (kind === 'blank' || kind === 'comment') continue;
    total += 1;
    if (kind === 'unknown') {
      invalid += 1;
      continue;
    }
    const m = DEF_RE.exec(raw);
    const call = m ? /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(raw.slice(m.index + m[0].length)) : null;
    const head = (call?.[1] ?? (m?.[1] ? '' : '')).toLowerCase();
    if (kind === 'property') {
      const pm = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(raw);
      const ph = pm?.[1]?.toLowerCase() ?? '';
      if (ph && !knownCommandLower.has(ph)) unknownCommands.push({ line: raw, head: ph });
    } else if (call && head && !knownCommandLower.has(head)) {
      unknownCommands.push({ line: raw, head });
    }
  }
  return {
    validity: total ? Math.round(((total - invalid) / total) * 10000) / 10000 : 1.0,
    invalidCount: invalid,
    total,
    unknownCommands,
  };
}

/**
 * 语义自查。
 *
 * `category` 只在**做题链路**给出（题图→GGB）：那时额外查 category_structure
 * （A 要函数、B 要多边形/圆…）。自由画图不给类别——「画条线段」被要求"缺函数对象"
 * 是废话，所以类别结构检查按需启用，其余检查（语法率、文字残留、动点自洽）恒跑。
 */
export function semanticCheck(
  category: string | undefined,
  candidateText: string,
  opts: { knownCommandLower?: Set<string>; mode?: Mode } = {},
): SemanticResult {
  const { objs, defs } = classifyDefs(candidateText);
  const failures: SemanticFailure[] = [];
  const kinds = new Set(objs.map((o) => o.kind));
  const objNames = new Set(objs.map((o) => o.name));
  const sliderNames = new Set(objs.filter((o) => o.kind === 'slider').map((o) => o.name));

  // 1) 语法有效率
  const lines = opts.knownCommandLower
    ? checkLines(candidateText, opts.knownCommandLower)
    : null;
  const validity = lines?.validity ?? 1.0;
  if (validity < 0.95) {
    failures.push({
      check: 'syntax',
      detail: `指令有效率 ${validity}，无效行 ${lines?.invalidCount ?? 0} 行`,
    });
  }

  // 2) 残留文字对象
  const textObjs = objs.filter((o) => o.kind === 'text').map((o) => o.name);
  if (textObjs.length) {
    failures.push({
      check: 'no_text',
      detail: `存在文字对象 ${JSON.stringify(textObjs)}，题目文字不应生成 Text 对象，请删除这些行`,
    });
  }

  // 3) 动点自由度自洽（Python 判据同款）
  const boundAll = new Set<string>();
  for (const d of defs) for (const b of d.bound) boundAll.add(b);
  const variants = new Set<string>();
  for (const n of objNames) for (const i of [1, 2, 3]) variants.add(`${n}_${i}`);
  const isKnown = (ident: string): boolean => {
    const low = ident.toLowerCase();
    return objNames.has(ident) || boundAll.has(ident) || variants.has(ident)
      || MATH_FUNCS.has(low) || (opts.knownCommandLower?.has(low) ?? false);
  };

  const freeParams = new Map<string, string>();
  for (const { name, rhs } of defs) {
    for (const ident of idents(rhs)) {
      if (!isKnown(ident) && !freeParams.has(ident)) freeParams.set(ident, name);
    }
  }
  if (freeParams.size) {
    const first = freeParams.keys().next().value as string;
    const pairs = [...freeParams.entries()].map(([p, owner]) => `${p}（被 ${owner} 引用）`).join('；');
    failures.push({
      check: 'free_param',
      detail: `引用了未定义的名字 ${pairs}。若这是动点参数，动点未设置可动机制：` +
        `请加 ${first} = Slider(...) 并让点坐标引用它（如 P=(${first}, f(${first}))），` +
        `或改为路径动点 Point(路径[, 参数])；若是笔误请修正对象名`,
    });
  }

  const referenced = new Set<string>();
  for (const { rhs } of defs) for (const ident of idents(rhs)) referenced.add(ident);
  const orphan = [...sliderNames].filter((n) => !referenced.has(n)).sort();
  if (orphan.length) {
    failures.push({
      check: 'orphan_slider',
      detail: `滑块 ${JSON.stringify(orphan)} 未驱动任何对象。若题目有动点，动点坐标应引用滑块` +
        `（如 P=(${orphan[0]}, f(${orphan[0]}))）；若题目无动点，应删除多余滑块`,
    });
  }

  // 4) 类别结构要求（文案与 Python 对齐）
  if (category === 'A') {
    if (!([...kinds].some((k) => k === 'function' || k === 'equation'))) {
      failures.push({ check: 'category_structure', detail: '函数与图像类题目：图中缺少函数或方程对象（应有 f(x)=... 或显式曲线方程）' });
    }
  } else if (category === 'B') {
    if (!([...kinds].some((k) => B_HEADS.has(k) || k === 'circle'))) {
      failures.push({ check: 'category_structure', detail: '平面几何类题目：缺少多边形/圆等几何对象，仅有孤立的点和线不满足题意' });
    }
  } else if (category === 'C') {
    if (!([...kinds].some((k) => CONIC_KINDS.has(k)))) {
      failures.push({ check: 'category_structure', detail: '解析几何类题目：缺少圆锥曲线对象（Parabola/Ellipse/Hyperbola 或二次方程曲线），请用题目给定的方程或条件构造圆锥曲线' });
    }
  } else if (category === 'D') {
    const mode = (opts.mode ?? detectModeText(candidateText)).toUpperCase();
    const has3d = [...kinds].some((k) => ['point3d', 'polygon3d', 'sphere', 'cone', 'cylinder'].includes(k))
      || /(?:Point|Polygon)\s*\([^)]*,[^)]*,[^)]*\)/i.test(candidateText)
      || /\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\)/.test(candidateText);
    if (mode !== '3D' && !has3d) {
      failures.push({ check: 'category_structure', detail: '立体几何类题目：应为 3D 视图（MODE: 3D）且含空间点/空间多边形，当前图是平面图，请按立体几何骨架重做' });
    }
  }

  return {
    ok: failures.length === 0,
    validity,
    failures,
    summary: failures.map((f) => `${f.check}: ${f.detail.slice(0, 60)}`).join('; '),
  };
}

function detectModeText(text: string): string {
  for (const line of text.split('\n')) {
    const { kind } = classifyLine(line);
    if (kind === 'mode') return /3d/i.test(line) ? '3D' : '2D';
  }
  return '2D';
}

/** D 规则过滤：删除 Text 类对象的定义行及其属性行。Python strip_text_objects 同款。 */
export function stripTextObjects(candidateText: string): string {
  const { objs } = classifyDefs(candidateText);
  const textNames = new Set(objs.filter((o) => o.kind === 'text').map((o) => o.name.toLowerCase()));
  if (textNames.size === 0) return candidateText;
  const out: string[] = [];
  for (const line of candidateText.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const sLow = s.toLowerCase();
    let dropped = false;
    for (const tn of textNames) {
      if (sLow === `${tn} = text(...)` || sLow.startsWith(`${tn}=text(`) || sLow.startsWith(`${tn} = text(`)) {
        dropped = true;
        break;
      }
      if (sLow.startsWith('set') && s.includes('(')) {
        const firstArg = s.split('(', 2)[1].split(',')[0].trim().replace(/^"|"$/g, '').toLowerCase();
        if (firstArg === tn) {
          dropped = true;
          break;
        }
      }
    }
    if (!dropped) out.push(line);
  }
  return out.join('\n') + '\n';
}
