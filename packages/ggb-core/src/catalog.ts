/**
 * 命令调用校验（`ggb_catalog.py` 的 TS 移植）——**不是** GeoGebra 表达式求值器。
 *
 * 只做两件事（2026-10-15 收敛后的职责）：
 *   ① 命令名在不在白名单（不在 → 未知；在 rejected_commands → 已知非法）
 *   ② 用法对不对（**只有白名单里带了签名的才查**：参数个数、参数类型、2D/3D 视图）
 *
 * **没签名的命令只做名称检查**——这是刻意的设计，不是漏做。看 ggb_commands.json 的
 * `signature_note`：「Commands absent from signatures are name-only checked.」
 * 因为签名写错比不写更糟：它会把合法调用误判成非法。112 个命令里 66 个有签名，
 * 缺的那 46 个多是大/小多态的（Distance/Angle/Area…）、变参的（Min/Max/Sequence…）、
 * 或副作用类（ZoomIn/Delete/Execute…）。
 *
 * 三条保守原则（与 Python 版一致）：
 *   - **无法静态判定的交给 GeoGebra**：类型推断不出来就返回 null，`compatible(null, …)` 恒真。
 *   - **只报不删**：这里产出的是「可疑行 + 理由」，调用方决定怎么办；绝不替用户改文件。
 *   - **类型家族兼容**：`coordinate` 可以当 `point` 也可以当 `vector`（GeoGebra 是动态的）。
 *
 * 这条路径替代了此前那个用 `classifyLine(...).kind === 'unknown'` 当有效性判据的做法——
 * 那个判据是**结构分类**（给 diff / 依赖分析用的），拿它判有效性会把 `ShowGrid(1, true)`、
 * `ZoomIn(2)`、`CenterView((0,0))` 这些合法命令全误报成无效（实测踩过）。
 */

import fs from 'node:fs';
import path from 'node:path';

export interface CommandSignature {
  args: string[];
  result: string;
  source?: string;
  /** 变参：多出来的实参按这个类型算（如 `Polygon(point, point, point, ...point)`） */
  variadic?: string;
  /** 最少几个实参（`args` 列的是「全部可选位」，如 Slider 的 9 个位最少给 2 个） */
  min_args?: number;
  /** 该重载适用的视图（缺省 = 2d + 3d） */
  views?: string[];
}

interface RawCatalog {
  constructors: Record<string, string[]>;
  attributes: string[];
  globals: string[];
  aliases?: Record<string, string>;
  rejected_commands?: Record<string, string>;
  expression_functions?: string[];
  signatures?: Record<string, CommandSignature[]>;
}

export interface Catalog {
  /** 小写命令名 → 它属于哪些视图（如 `circle` → ['2d']） */
  constructors: Map<string, { views: string[] }>;
  /** 小写命令名 → 规范显示名（含 attributes / globals） */
  canonical: Map<string, string>;
  attributes: Set<string>;
  globals: Set<string>;
  /** 小写别名 → 小写目标 */
  aliases: Map<string, string>;
  signatures: Map<string, CommandSignature[]>;
  /** 已确认非法的命令 → 修正提示（如 `bestfitline` → 「用 FitLine(list)」） */
  rejected: Map<string, string>;
  expressionFunctions: Set<string>;
}

let cached: { root: string; value: Catalog } | null = null;

/** 读并索引命令目录。按 rootDir 记忆化——那份 JSON 一生只读一次。 */
export function loadCatalog(rootDir: string): Catalog {
  if (cached && cached.root === rootDir) return cached.value;
  const raw = JSON.parse(fs.readFileSync(path.join(rootDir, 'ggb_commands.json'), 'utf-8')) as RawCatalog;

  const constructors = new Map<string, { views: string[] }>();
  const canonical = new Map<string, string>();
  for (const [view, names] of Object.entries(raw.constructors)) {
    for (const name of names) {
      const low = name.toLowerCase();
      canonical.set(low, name);
      const entry = constructors.get(low) ?? { views: [] };
      entry.views.push(view);
      constructors.set(low, entry);
    }
  }
  const attributes = new Set((raw.attributes ?? []).map((n) => n.toLowerCase()));
  const globals = new Set((raw.globals ?? []).map((n) => n.toLowerCase()));
  for (const name of [...(raw.attributes ?? []), ...(raw.globals ?? [])]) {
    canonical.set(name.toLowerCase(), name);
  }
  const aliases = new Map(
    Object.entries(raw.aliases ?? {}).map(([a, b]) => [a.toLowerCase(), b.toLowerCase()]),
  );
  const signatures = new Map(
    Object.entries(raw.signatures ?? {}).map(([n, s]) => [n.toLowerCase(), s]),
  );
  const rejected = new Map(
    Object.entries(raw.rejected_commands ?? {}).map(([n, h]) => [n.toLowerCase(), h]),
  );

  const value: Catalog = {
    constructors, canonical, attributes, globals, aliases, signatures, rejected,
    expressionFunctions: new Set((raw.expression_functions ?? []).map((n) => String(n).toLowerCase())),
  };
  cached = { root: rootDir, value };
  return value;
}

/**
 * 切参数：保留空参数、尊重嵌套定界符与字符串转义。
 * 例：`Circle((0, 0), "a,b")` → `['(0, 0)', '"a,b"']`
 */
export function splitArgs(text: string): string[] {
  if (!text.trim()) return [];
  const parts: string[] = [];
  const stack: string[] = [];
  const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (!stack.length || CLOSERS[ch] !== stack.pop()) throw new Error('Unbalanced delimiters');
    } else if (ch === ',' && !stack.length) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (stack.length || quoted) throw new Error('Unbalanced delimiters or unterminated string');
  parts.push(text.slice(start).trim());
  return parts;
}

export interface Call {
  /** 源码里的拼写（未过别名） */
  spelling: string;
  args: string[];
  /** 在表达式里的位置（`(` 的索引 / `)` 的索引），用于判断「是不是被当表达式用」 */
  start: number;
  end: number;
}

/**
 * 找出表达式里**所有**调用（含嵌套、列表、坐标内的）。
 * 只有紧贴 `(`/`[` 前面的标识符才算命令头——`(0, 0)` 这种裸元组不算。
 */
export function callsIn(expression: string): Call[] {
  const stack: Array<{ ch: string; start: number; head: string | null }> = [];
  const calls: Call[] = [];
  const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === '(' || ch === '[' || ch === '{') {
      // 紧邻前面的标识符才是命令头；`{` 永不带头（列表字面量）
      const head = ch === '{' ? null : /([A-Za-z][A-Za-z0-9_]*)\s*$/.exec(expression.slice(0, i))?.[1] ?? null;
      stack.push({ ch, start: i, head });
    } else if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack.pop();
      if (!top || CLOSERS[ch] !== top.ch) throw new Error('Unbalanced delimiters');
      if (top.head) calls.push({ spelling: top.head, args: splitArgs(expression.slice(top.start + 1, i)), start: top.start, end: i });
    }
  }
  if (stack.length || quoted) throw new Error('Unbalanced delimiters or unterminated string');
  return calls;
}

/** 类型家族：`expected` 里写家族名时，家族内任一成员都算兼容。 */
const FAMILIES: Record<string, Set<string>> = {
  object: new Set(['point', 'number', 'boolean', 'string', 'list', 'line', 'segment', 'ray', 'vector', 'conic', 'function', 'curve', 'polygon', 'plane', 'quadric']),
  geometry: new Set(['point', 'line', 'segment', 'ray', 'conic', 'function', 'curve', 'polygon', 'plane', 'quadric']),
  path: new Set(['line', 'segment', 'ray', 'conic', 'function', 'curve', 'polygon']),
  region: new Set(['polygon', 'conic', 'plane', 'quadric']),
  direction: new Set(['line', 'segment', 'ray', 'vector']),
};

/**
 * 实参类型 `actual` 能不能当 `expected` 用。
 * `expected` 可以是 `a|b|c` 联合；`actual` 为 null（推断不出）恒真——交给 GeoGebra。
 */
export function compatible(actual: string | null, expected: string): boolean {
  if (actual === null || actual === 'any' || actual === 'geometry' || expected === 'any') return true;
  if (actual === 'coordinate') {
    // 裸元组既可能是点也可能是向量，取决于命名/上下文
    return compatible('point', expected) || compatible('vector', expected);
  }
  return expected.split('|').some((part) => actual === part || FAMILIES[part]?.has(actual));
}

/** 实参个数能不能落在签名上。 */
export function arityMatches(signature: CommandSignature, count: number): boolean {
  const size = signature.args.length;
  if (signature.variadic) return count >= size;
  return (signature.min_args ?? size) <= count && count <= size;
}

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** 从**文本**推类型。推不出返回 null（保守——交给 GeoGebra 判）。 */
export function inferType(expression: string, types: Map<string, string>, catalog: Catalog): string | null {
  const value = expression.trim();
  if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') return 'boolean';
  if (value === 'space') return 'space';
  const declared = types.get(value);
  if (declared) return declared;
  if (value === 'xAxis' || value === 'yAxis' || value === 'zAxis') return 'line';
  if (NUMBER_RE.test(value)) return 'number';
  if (value.startsWith('"') && value.endsWith('"')) return 'string';
  if (value.startsWith('{') && value.endsWith('}')) return 'list';
  if (value.startsWith('(') && value.endsWith(')')) {
    try {
      if ([2, 3].includes(splitArgs(value.slice(1, -1)).length)) return 'coordinate';
    } catch {
      return null;
    }
  }
  let calls: Call[];
  try {
    calls = callsIn(value);
  } catch {
    return null;
  }
  // 只有当整个表达式**就是**这一个调用时，才能用它的返回类型
  const root = calls.find((c) => value.slice(0, c.start).trim() === c.spelling && !value.slice(c.end + 1).trim());
  if (!root) return null;
  const head = catalog.aliases.get(root.spelling.toLowerCase()) ?? root.spelling.toLowerCase();
  if (catalog.expressionFunctions.has(head)) return 'number';
  if (types.get(root.spelling) === 'function') return 'number';
  const actuals = root.args.map((arg) => inferType(arg, types, catalog));
  const results = new Set<string>();
  for (const signature of catalog.signatures.get(head) ?? []) {
    if (!arityMatches(signature, root.args.length)) continue;
    const ok = actuals.every((actual, i) =>
      compatible(actual, i < signature.args.length ? signature.args[i] : signature.variadic ?? 'any'));
    if (ok) results.add(signature.result);
  }
  return results.size === 1 ? [...results][0] : null;
}

/**
 * 把命令的重载格式化成「合法形式」清单，供报错时附给 agent。
 *
 * 为什么要有它：光说「参数类型不匹配」agent 得自己猜该写什么（实测它为此绕了三轮——
 * `Ellipse` 传了线段当焦点，报错只说类型不对，它试了三种写法才试对）。而**合法形式
 * 我们手上就有**（签名里就是全部重载），直接列出来它一轮就能改对。
 *
 * 类型名**保持 GeoGebra 原样**（point / segment / number…）：它们是 GeoGebra 自己的
 * 术语，翻成中文是凭空造词（region→区域？direction→方向？），而 agent 查文档、
 * 读 GeoGebra 报错时见到的都是英文。
 *
 * 传进来的应当是**已经筛过**的那批重载（按参数个数、按视图）——这样列出的是
 * 「你这种情况能用哪几个形式」，而不是把全部重载倒给它自己挑。
 */
export function describeOverloads(name: string, signatures: CommandSignature[]): string {
  if (!signatures.length) return '';
  const forms = signatures.map((s) => {
    const min = s.min_args ?? s.args.length;
    // 可选位用方括号标出，别让 agent 以为全都要给
    const shown = s.args.map((a, i) => (i >= min ? `[${a}]` : a));
    if (s.variadic) shown.push(`…${s.variadic}`);
    return `  ${name}(${shown.join(', ')})`;
  });
  return `合法形式：\n${forms.join('\n')}`;
}

export interface CallProblem {
  /** 出问题的源码拼写 */
  spelling: string;
  /** 人类可读的理由（直接给 agent 看） */
  detail: string;
  kind: 'unknown' | 'rejected' | 'arity' | 'type' | 'view' | 'not-an-expression' | 'coordinate';
}

export interface LineInspection {
  /** 这一行的问题（空 = 通过） */
  problems: CallProblem[];
  /** 推断出的这行结果的类型（`f(x)=` 形式记 'function'） */
  result: string | null;
}

const LHS_RE = /^([A-Za-z]\w*)(?:\(([^)]*)\))?\s*[:]?=/;

/**
 * 校验**一行**指令。`types` 是「已知对象名 → 类型」的环境（工作稿里先出现的定义）。
 *
 * 与 Python `inspect_line` 同构：命令名 + 签名（个数/类型/视图）+ rejected。
 * 未知命令**不报错**——它进 `problems` 的 `unknown` 类，由调用方决定怎么呈现
 * （Python 侧当年是「放行 + 遥测」）。
 */
export function inspectLine(
  line: string,
  types: Map<string, string>,
  localFunctions: Set<string>,
  mode: string | null = null,
  catalog?: Catalog,
  rootDir?: string,
): LineInspection {
  const cat = catalog ?? loadCatalog(rootDir ?? process.cwd());
  const lhs = LHS_RE.exec(line);
  const expression = lhs ? line.slice(lhs[0].length) : line;
  const problems: CallProblem[] = [];

  let calls: Call[];
  try {
    calls = callsIn(expression);
  } catch (e) {
    return { problems: [{ spelling: '', detail: e instanceof Error ? e.message : String(e), kind: 'unknown' }], result: null };
  }

  // 裸元组：各分量必须是数值
  const trimmed = expression.trim();
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    let parts: string[] = [];
    try {
      parts = splitArgs(trimmed.slice(1, -1));
    } catch {
      parts = []; // 是「若干括号表达式的和/积」，不是元组
    }
    if (parts.length === 2 || parts.length === 3) {
      for (const part of parts) {
        const actual = inferType(part, types, cat);
        if (!compatible(actual, 'number')) {
          problems.push({ spelling: part, detail: `坐标分量必须是数值，这里是 ${actual}`, kind: 'coordinate' });
        }
      }
    }
  }

  for (const call of calls) {
    const head = cat.aliases.get(call.spelling.toLowerCase()) ?? call.spelling.toLowerCase();
    if (cat.rejected.has(head)) {
      problems.push({ spelling: call.spelling, detail: cat.rejected.get(head)!, kind: 'rejected' });
      continue;
    }
    if (cat.expressionFunctions.has(head) || localFunctions.has(call.spelling)) continue;
    if (!cat.canonical.has(head)) {
      problems.push({ spelling: call.spelling, detail: `未知命令 ${call.spelling}`, kind: 'unknown' });
      continue;
    }
    const constructor = cat.constructors.get(head);
    if (mode === '2D' && constructor && !constructor.views.includes('2d')) {
      problems.push({ spelling: call.spelling, detail: `${call.spelling}: 需要 MODE: 3D`, kind: 'view' });
    }
    const signatures = cat.signatures.get(head);
    if (!signatures) continue; // 明确只做名称检查

    // 副作用命令（全是 void）不能当表达式用
    if (signatures.every((s) => s.result === 'void')) {
      const usedAsExpression = Boolean(lhs)
        || Boolean(expression.slice(call.end + 1).trim())
        || expression.slice(0, call.start).trim() !== call.spelling;
      if (usedAsExpression) {
        problems.push({ spelling: call.spelling, detail: `${call.spelling}: 副作用命令不能当表达式用`, kind: 'not-an-expression' });
      }
    }

    let options = signatures.filter((s) => arityMatches(s, call.args.length));
    if (!options.length || call.args.some((a) => !a)) {
      const empty = call.args.some((a) => !a);
      // 个数不对时列**全部**重载（没有「同个数的那批」可筛）
      problems.push({
        spelling: call.spelling,
        detail: `${call.spelling}: ${empty ? '有空参数' : `参数个数 ${call.args.length} 不受支持`}。\n` +
          describeOverloads(call.spelling, signatures),
        kind: 'arity',
      });
      continue;
    }
    if (mode === '2D') {
      options = options.filter((s) => (s.views ?? ['2d', '3d']).includes('2d'));
      if (!options.length) {
        problems.push({
          spelling: call.spelling,
          detail: `${call.spelling}: 这个重载需要 MODE: 3D。\n` +
            describeOverloads(call.spelling, signatures),
          kind: 'view',
        });
        continue;
      }
    }
    const actuals = call.args.map((arg) => inferType(arg, types, cat));
    const matches = options.some((signature) =>
      actuals.every((actual, i) =>
        compatible(actual, i < signature.args.length ? signature.args[i] : signature.variadic ?? 'any')));
    if (!matches) {
      // 只列**参数个数对得上**的那批重载——agent 不用自己从全部里挑。
      // 不再复述「你给的是什么类型」：那是它自己刚写的，告诉它已知的事是噪音。
      problems.push({
        spelling: call.spelling,
        detail: `${call.spelling}: 参数类型不对。\n` + describeOverloads(call.spelling, options),
        kind: 'type',
      });
    }
  }

  const result = lhs?.[2] !== undefined ? 'function' : inferType(expression, types, cat);
  return { problems, result };
}

/**
 * 校验一整份清单：按行序推类型环境（先定义的对象后面才能被引用），逐行查。
 *
 * 这是 `ggb_apply` 该调的东西——替代此前那个拿结构分类当有效性判据的做法。
 */
export interface LedgerCheck {
  /** 逐行的问题（行号是 0 基） */
  problems: Array<{ index: number; line: string; problems: CallProblem[] }>;
  /** 名字不在白名单的行文本（去重） */
  unknownLines: string[];
  mode: string | null;
}

export function inspectLedger(lines: string[], catalog?: Catalog, rootDir?: string, initialMode: string | null = '2D'): LedgerCheck {
  const cat = catalog ?? loadCatalog(rootDir ?? process.cwd());
  const types = new Map<string, string>();
  const localFunctions = new Set<string>();
  const problems: LedgerCheck['problems'] = [];
  const unknownLines: string[] = [];
  // 缺省 2D——与 parse.ts 的 detectMode 同语义（GeoGebra 默认也是 2D，MODE: 行才覆盖）
  let mode: string | null = initialMode;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('//')) return;
    if (/^MODE\s*:/i.test(line)) {
      mode = /3d/i.test(line) ? '3D' : '2D';
      return;
    }
    const { problems: lineProblems, result } = inspectLine(raw, types, localFunctions, mode, cat);

    // 记进类型环境，供后续行引用
    const lhs = LHS_RE.exec(line);
    if (lhs) {
      if (lhs[2] !== undefined) localFunctions.add(lhs[1]);
      if (result) types.set(lhs[1], result);
    }

    if (lineProblems.length) {
      problems.push({ index, line, problems: lineProblems });
      if (lineProblems.some((p) => p.kind === 'unknown')) unknownLines.push(line);
    }
  });

  return { problems, unknownLines: [...new Set(unknownLines)], mode };
}
