/**
 * 语义校验 —— 判据单测（free_param / orphan_slider / 结构 / 文字残留）。
 */

import { describe, expect, it } from 'vitest';
import { checkLines, semanticCheck, stripTextObjects } from '../src/semantic.ts';

const KNOWN = new Set(['point', 'line', 'function', 'polygon', 'circle', 'slider', 'text', 'setcolor', 'showlabel', 'ellipse', 'parabola']);

describe('semanticCheck', () => {
  it('free_param：引用未定义名字并给出设置可动机制的指引', () => {
    const r = semanticCheck('A', 'f = Function(t^2, -3, 3)\nP = (t, f(t))', { knownCommandLower: KNOWN });
    const fp = r.failures.find((f) => f.check === 'free_param');
    expect(fp).toBeTruthy();
    expect(fp!.detail).toContain('t');
    expect(fp!.detail).toContain('Slider');
  });

  it('orphan_slider：孤立滑块被抓', () => {
    const r = semanticCheck('A', 'f = Function(x^2, -3, 3)\ns = Slider(0, 1, 0.1)', { knownCommandLower: KNOWN });
    const os = r.failures.find((f) => f.check === 'orphan_slider');
    expect(os).toBeTruthy();
    expect(os!.detail).toContain('s');
  });

  it('合法的滑块驱动不算 free_param/orphan', () => {
    const r = semanticCheck('A', 't = Slider(0, 1, 0.1)\nf = Function(t x^2, -3, 3)', { knownCommandLower: KNOWN });
    expect(r.failures.filter((f) => f.check === 'free_param' || f.check === 'orphan_slider')).toEqual([]);
  });

  it('no_text：残留文字对象被抓', () => {
    const r = semanticCheck('B', 'A = Point(0, 0)\nmsg = Text("题目文字")', { knownCommandLower: KNOWN });
    expect(r.failures.some((f) => f.check === 'no_text')).toBe(true);
    expect(r.failures.find((f) => f.check === 'no_text')!.detail).toContain('msg');
  });

  it('类别结构：A 要函数/方程、B 要多边形/圆、C 要圆锥曲线', () => {
    expect(semanticCheck('A', 'A = Point(0, 0)', { knownCommandLower: KNOWN }).failures.some((f) => f.check === 'category_structure')).toBe(true);
    expect(semanticCheck('A', 'f = Function(x^2, -3, 3)', { knownCommandLower: KNOWN }).failures.some((f) => f.check === 'category_structure')).toBe(false);
    expect(semanticCheck('B', 'A = Point(0, 0)\nB = Point(1, 0)', { knownCommandLower: KNOWN }).failures.some((f) => f.check === 'category_structure')).toBe(true);
    expect(semanticCheck('B', 'c = Circle((0,0), 1)', { knownCommandLower: KNOWN }).failures.some((f) => f.check === 'category_structure')).toBe(false);
    expect(semanticCheck('C', 'c = Circle((0,0), 1)', { knownCommandLower: KNOWN }).failures.some((f) => f.check === 'category_structure')).toBe(true);
    expect(semanticCheck('C', 'e = Ellipse((0,0), (2,0), 1)', { knownCommandLower: KNOWN }).failures.some((f) => f.check === 'category_structure')).toBe(false);
  });

  it('D 类要求 3D（MODE: 3D 或空间坐标）', () => {
    expect(semanticCheck('D', 'A = Point(0, 0)', { knownCommandLower: KNOWN }).failures.some((f) => f.check === 'category_structure')).toBe(true);
    expect(semanticCheck('D', 'MODE: 3D\nA = Point(0, 0, 0)', { knownCommandLower: KNOWN }).failures.some((f) => f.check === 'category_structure')).toBe(false);
  });

  it('语法有效率低于 0.95 报 syntax', () => {
    const r = semanticCheck('A', 'f = Function(x^2, -3, 3)\n@@@garbage###\n???another', { knownCommandLower: KNOWN });
    expect(r.failures.some((f) => f.check === 'syntax')).toBe(true);
  });
});

describe('checkLines', () => {
  it('未知命令头进 unknownCommands，垃圾行扣 validity', () => {
    const r = checkLines('A = Point(0, 0)\nf = Frobulate(1)\n@@@bad', KNOWN);
    expect(r.unknownCommands.map((u) => u.head)).toContain('frobulate');
    expect(r.invalidCount).toBeGreaterThanOrEqual(1);
    expect(r.validity).toBeLessThan(1);
  });
});

describe('stripTextObjects', () => {
  it('删除 Text 定义行与首参为它的属性行，其余保留', () => {
    const out = stripTextObjects('A = Point(0, 0)\nmsg = Text("hi")\nSetColor(msg, "#FF0000")\nSetColor(A, "#00FF00")\n');
    expect(out).toContain('A = Point(0, 0)');
    expect(out).toContain('SetColor(A, "#00FF00")');
    expect(out).not.toContain('msg = Text');
    expect(out).not.toContain('SetColor(msg');
  });
});

describe('category_structure 按需启用', () => {
  const bare = 'A = Point(0, 0)\nB = Point(1, 1)';

  it('自由画图不给类别时，不套题目类别结构', () => {
    // 「画两个点」不该被要求"缺函数对象"——那只是做题链路的要求
    const r = semanticCheck(undefined, bare, { knownCommandLower: KNOWN });
    expect(r.failures.some((f) => f.check === 'category_structure')).toBe(false);
  });

  it('做题给了类别时照旧查结构', () => {
    const r = semanticCheck('A', bare, { knownCommandLower: KNOWN });
    expect(r.failures.some((f) => f.check === 'category_structure')).toBe(true);
  });

  it('动点自洽与文字残留与类别无关，恒查', () => {
    const r = semanticCheck(undefined, 'A = Point(0, 0)\nmsg = Text("hi")', { knownCommandLower: KNOWN });
    expect(r.failures.some((f) => f.check === 'no_text')).toBe(true);
  });
});
