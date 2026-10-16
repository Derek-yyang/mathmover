/**
 * 命令调用校验（`ggb_catalog.py` 的 TS 移植）。
 *
 * 锁住的语义：
 * - **只查两件事**：名字在不在白名单、用法对不对（**只有带签名的命令**才查用法）
 * - **没签名 = 只查名字**（`signature_note` 明写；112 个里 66 个有签名）
 * - **保守**：推不出类型就放行（交给 GeoGebra）、coordinate 可当 point 也可当 vector
 * - 回归钉子：`ShowGrid(1, true)` / `ZoomIn(2)` / `CenterView((0,0))` 这些**合法命令
 *   曾被误报成无效**（旧判据拿 `classifyLine` 的结构分类当有效性），一个都不许再误报
 */

import { describe, expect, it } from 'vitest';
import {
  arityMatches, callsIn, compatible, inferType, inspectLedger, inspectLine,
  loadCatalog, splitArgs, type Catalog,
} from '../src/catalog.ts';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const cat = loadCatalog(REPO_ROOT);
const check = (line: string, types: Record<string, string> = {}, mode: string | null = null) =>
  inspectLine(line, new Map(Object.entries(types)), new Set(), mode, cat);
const kinds = (line: string, types: Record<string, string> = {}, mode: string | null = null) =>
  check(line, types, mode).problems.map((p) => p.kind);

describe('切参数与找调用', () => {
  it('splitArgs 保留空参数、尊重嵌套与字符串里的逗号', () => {
    expect(splitArgs('(0, 0), "a,b"')).toEqual(['(0, 0)', '"a,b"']);
    expect(splitArgs('a, , b')).toEqual(['a', '', 'b']);
    expect(splitArgs('')).toEqual([]);
    expect(() => splitArgs('(a, b')).toThrow();
  });

  it('callsIn 只认紧贴括号前的标识符（裸元组不算调用）', () => {
    expect(callsIn('Circle(A, 3)').map((c) => c.spelling)).toEqual(['Circle']);
    expect(callsIn('(0, 0)')).toEqual([]);
    // 嵌套：外层 + 内层都要找到
    expect(callsIn('Line(Point(0,0), Point(1,1))').map((c) => c.spelling)).toEqual(['Point', 'Point', 'Line']);
  });
});

describe('类型兼容', () => {
  it('推不出（null）恒真——交给 GeoGebra', () => {
    expect(compatible(null, 'point')).toBe(true);
    expect(compatible(null, 'number|point')).toBe(true);
  });
  it('coordinate 既可当 point 也可当 vector', () => {
    expect(compatible('coordinate', 'point')).toBe(true);
    expect(compatible('coordinate', 'vector')).toBe(true);
    expect(compatible('coordinate', 'number')).toBe(false);
  });
  it('联合类型与家族', () => {
    expect(compatible('point', 'point|number')).toBe(true);
    expect(compatible('line', 'path')).toBe(true);      // line 属于 path 家族
    expect(compatible('number', 'path')).toBe(false);
  });
  it('arityMatches：variadic 与 min_args', () => {
    expect(arityMatches({ args: ['point', 'point', 'point'], result: 'polygon' }, 3)).toBe(true);
    expect(arityMatches({ args: ['point', 'point', 'point'], result: 'polygon', variadic: 'point' }, 5)).toBe(true);
    expect(arityMatches({ args: ['number', 'number'], result: 'number', min_args: 1 }, 1)).toBe(true);
  });
  it('inferType：字面量、已声明对象、点/向量/列表/字符串', () => {
    const types = new Map([['A', 'point'], ['n', 'number']]);
    expect(inferType('1.5', types, cat)).toBe('number');
    expect(inferType('"红"', types, cat)).toBe('string');
    expect(inferType('{1, 2}', types, cat)).toBe('list');
    expect(inferType('(0, 0)', types, cat)).toBe('coordinate');
    expect(inferType('true', types, cat)).toBe('boolean');
    expect(inferType('A', types, cat)).toBe('point');
    expect(inferType('没见过的名字', types, cat)).toBe(null);
  });
});

describe('回归：合法命令不许被误报', () => {
  // 这些全是白名单里的合法命令，且首参不是「对象名」——旧判据把它们全判成 unknown
  it.each([
    ['ShowGrid(1, true)'],
    ['ShowAxes(1, true)'],
    ['ShowGrid(true)'],
    ['ZoomIn(2)'],
    ['CenterView((0,0))'],
    ['SetPerspective("G")'],
    ['SetActiveView(1)'],
    ['UpdateConstruction()'],
    ['c = Circle((0,0), 3)'],
    ['A = (0, 0)'],
    ['SetColor(f, "#FF0000")'],
  ])('%s 不报任何问题', (line) => {
    expect(check(line).problems).toEqual([]);
  });

  it('今天真实翻车的那两行：agent 写了、我们误报、它白改了三轮', () => {
    expect(kinds('ShowGrid(1, true)')).toEqual([]);
    expect(kinds('ShowAxes(1, true)')).toEqual([]);
  });
});

describe('未知与已确认非法', () => {
  it('名字不在白名单 → unknown（拼写错误）', () => {
    expect(kinds('Tangnet(A, 1)', { A: 'point' })).toContain('unknown');
  });
  it('rejected_commands → 带上修正提示', () => {
    const p = check('BestFitLine({(0,0)})').problems[0];
    expect(p.kind).toBe('rejected');
    expect(p.detail).toContain('FitLine');
  });
});

describe('用法：只有带签名的命令才查', () => {
  it('参数个数不对', () => {
    expect(kinds('Circle(A)', { A: 'point' })).toContain('arity');
  });
  it('参数类型不对', () => {
    expect(kinds('Circle(A, "red")', { A: 'point' })).toContain('type');
  });
  it('2D 模式下用了 3D 专属命令', () => {
    expect(kinds('Sphere((0,0,0), 1)', {}, '2D')).toContain('view');
  });
  it('副作用命令不能当表达式用', () => {
    // SetValue 是全 void 签名的副作用命令（ZoomIn/Delete 没签名，不走这条路）
    expect(kinds('x = SetValue(a, 5)', { a: 'number' })).toContain('not-an-expression');
  });
  it('没签名的命令只查名字——参数随便写也不报', () => {
    // ZoomIn / Delete 都没有签名，是刻意的 name-only 覆盖
    expect(check('ZoomIn(随便, 乱写)').problems).toEqual([]);
    expect(check('Delete(1, 2, 3, 4)').problems).toEqual([]);
  });
});

describe('报错要可操作：给出合法形式', () => {
  // 实测教训：agent 画椭圆时 `Ellipse(线段, 线段, 数)` 被判类型不匹配，但报错只说
  // 「类型不匹配」——它自己摸索了三轮才搞明白「前两个参数必须是点」。合法形式我们
  // 手上就有（签名里就是全部重载），列出来它一轮就能改对。

  it('类型不对时只列**参数个数对得上**的那批重载（不用它自己从全部里挑）', () => {
    const p = check('ellipseC = Ellipse(f1, f2, 4)', { f1: 'segment', f2: 'segment' }).problems[0];
    expect(p.kind).toBe('type');
    expect(p.detail).toContain('Ellipse(point, point, number|point|segment)');
  });

  it('不复述「你给的是什么类型」——那是 agent 自己刚写的', () => {
    const p = check('ellipseC = Ellipse(f1, f2, 4)', { f1: 'segment', f2: 'segment' }).problems[0];
    // 首行只说明「哪里不对」，不复述实参
    expect(p.detail.split('\n')[0]).toBe('Ellipse: 参数类型不对。');
  });

  it('类型名保持 GeoGebra 原样（不翻中文——那是凭空造词）', () => {
    const p = check('ellipseC = Ellipse(f1, f2, 4)', { f1: 'segment', f2: 'segment' }).problems[0];
    const forms = p.detail.slice(p.detail.indexOf('合法形式'));
    expect(forms).toContain('point');
    expect(forms).toContain('segment');
    // 合法形式那几行里不该有中文类型名
    expect(forms).not.toMatch(/[点线数向区域]/);
  });

  it('参数个数不对时列**全部**重载（没有同个数的那批可筛）', () => {
    const p = check('c = Circle(A)', { A: 'point' }).problems[0];
    expect(p.kind).toBe('arity');
    expect(p.detail).toContain('Circle(point, point, point)');
    expect(p.detail).toContain('Circle(line, point)');
  });

  it('可选位用方括号标出（别让 agent 以为全都要给）', () => {
    const p = check('s = Slider(1)').problems[0];
    expect(p.kind).toBe('arity');
    expect(p.detail).toContain('[');   // Slider 的 min_args=2，后面的位是可选
  });
});

describe('整份清单', () => {
  it('按行序推类型：先定义的对象后面才认得', () => {
    const r = inspectLedger(['A = (0, 0)', 'c = Circle(A, 3)', 'SetColor(c, "#f00")'], cat);
    expect(r.problems).toEqual([]);
    expect(r.unknownLines).toEqual([]);
  });

  it('报告问题行（带行号）并收集未知行', () => {
    const r = inspectLedger(['A = (0, 0)', 'Tangnet(A, 1)', 'c = Circle(A, 3)'], cat);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].index).toBe(1);
    expect(r.unknownLines).toEqual(['Tangnet(A, 1)']);
  });

  it('MODE: 3D 之后 3D 命令不再报视图错', () => {
    expect(inspectLedger(['Sphere((0,0,0), 1)'], cat, REPO_ROOT).problems).toHaveLength(1);
    expect(inspectLedger(['MODE: 3D', 'Sphere((0,0,0), 1)'], cat, REPO_ROOT).problems).toEqual([]);
  });
});
