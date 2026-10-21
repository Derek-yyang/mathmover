/**
 * 语义校验（判据移植自原 Python `semantic_guard.py`，该文件已随一次性生成管线下线）。
 *
 * 忠实移植的部分：free_param / orphan_slider 的判据与文案（_DEF_RE/_TOKEN_RE 逻辑）。
 * （Python 的 strip_text_objects 曾一并移植为 stripTextObjects，2026-10-11 删除——
 *   调用者随一次性管线一起下线了；且「悄悄删」与「校验不拦路」的不变量相反。）
 *
 * 2026-10-15：`syntax` / `no_text` / `category_structure` 三条移除，判据与理由见
 * `semanticCheck` 的注释。本模块至此不再需要 category。
 *
 * 记录在案的实现差异：Python 侧对象 kind 由 ggb_parser 的表达式精化（圆锥/方程
 * 识别等多趟启发式）给出；这里按**定义命令头**分类 + 少量表达式启发（二次项
 * 记 conic-ish）。对 SOP 卡驱动的生成（卡里教的就是 Conic/Function 等构造器）
 * 覆盖一致；对隐式方程写法（e: x^2+y^2=1）的识别是启发式的。
 * 参数级命令校验（ggb_catalog.inspect_line）不在本层——未知命令名记 command_error。
 */

export interface SemanticFailure {
  check: string;
  detail: string;
}

export interface SemanticResult {
  ok: boolean;
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
/** 多边形/圆类命令头——`classifyDefs` 靠它给对象定 kind（形状检查已移除，分类仍用）。 */
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

/**
 * 语义自查 —— **只查「与类别无关、且从指令文本里看不出来」的东西**。
 *
 * 现存两条：free_param（引用了未定义的名字）与 orphan_slider（滑块没驱动任何对象）。
 * 共同点是**必须把依赖图算出来才知道**：agent 读自己写的 `a = Slider(3, 8, 0.5)`
 * 看不出全篇没一处引用 a；画布体检也只会说「对象建好了、有值」。而一个拖了没反应的
 * 滑块，正是「精确可控的动图」这个卖点的反面。
 *
 * 2026-10-15 移除三条：
 *  - `syntax`（指令有效率）——行级白名单检查 `checkLines` 已经覆盖，再报一遍是噪音；
 *  - `no_text`（残留文字对象）与 `category_structure`（按类别的形状要求）——都是
 *    **按类别的形状启发式**，且与 agent 已拿到的专家 skill 重复（skill 里已写明
 *    该类题该建什么骨架，再 nag 一遍是同一件事说两遍）。
 *
 * 移除后本函数**不再需要 category**——写路径（ggb_apply）因此与类别彻底解耦，
 * 类别只剩「选哪套专家知识」一个用途（get_expert_prompt）。
 *
 * （沿革：no_text 原归在「恒跑」里，2026-10-11 挪到 category 门后，因为它误伤纯画图——
 *   用户要一段说明文字是合理的；标签另说，产品约定是 ShowLabel/SetLabelMode 挂在对象上。）
 */
export function semanticCheck(
  candidateText: string,
  opts: { knownCommandLower?: Set<string> } = {},
): SemanticResult {
  const { objs, defs } = classifyDefs(candidateText);
  const failures: SemanticFailure[] = [];
  const objNames = new Set(objs.map((o) => o.name));
  const sliderNames = new Set(objs.filter((o) => o.kind === 'slider').map((o) => o.name));

  // 动点自由度自洽（Python 判据同款）
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

  return {
    ok: failures.length === 0,
    failures,
    summary: failures.map((f) => `${f.check}: ${f.detail.slice(0, 60)}`).join('; '),
  };
}
