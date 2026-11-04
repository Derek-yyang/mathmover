/**
 * 语义校验 —— 判据单测。
 *
 * 只查「与类别无关、且从指令文本里看不出来」的两条：free_param / orphan_slider。
 * 2026-10-15 移除 syntax / no_text / category_structure，理由见 src/semantic.ts 的注释。
 * 同日的行级检查（`checkLines`）也已下线——它拿结构分类当有效性判据，会误报合法命令；
 * 职责移交给 src/catalog.ts 的 `inspectLedger`（见 test/catalog.test.ts）。
 */

import { describe, expect, it } from 'vitest';
import { semanticCheck } from '../src/semantic.ts';

const KNOWN = new Set(['point', 'line', 'function', 'polygon', 'circle', 'slider', 'text', 'setcolor', 'showlabel', 'ellipse', 'parabola']);

describe('semanticCheck', () => {
  it('free_param：引用未定义名字并给出设置可动机制的指引', () => {
    const r = semanticCheck('f = Function(t^2, -3, 3)\nP = (t, f(t))', { knownCommandLower: KNOWN });
    const fp = r.failures.find((f) => f.check === 'free_param');
    expect(fp).toBeTruthy();
    expect(fp!.detail).toContain('t');
    expect(fp!.detail).toContain('Slider');
  });

  it('orphan_slider：孤立滑块被抓', () => {
    const r = semanticCheck('f = Function(x^2, -3, 3)\ns = Slider(0, 1, 0.1)', { knownCommandLower: KNOWN });
    const os = r.failures.find((f) => f.check === 'orphan_slider');
    expect(os).toBeTruthy();
    expect(os!.detail).toContain('s');
  });

  it('合法的滑块驱动不算 free_param/orphan', () => {
    const r = semanticCheck('t = Slider(0, 1, 0.1)\nf = Function(t x^2, -3, 3)', { knownCommandLower: KNOWN });
    expect(r.failures.filter((f) => f.check === 'free_param' || f.check === 'orphan_slider')).toEqual([]);
  });

  it.each([':', ' : ', ': '])('冒号命名的双曲线可被求交引用（分隔符 %j）', (separator) => {
    const text = [
      'MODE:2D',
      `conicC${separator}x^2/2 - y^2 = 1`,
      'b = Slider(1.1, 1.8, 0.01)',
      'l = Line((0, b), (1, b - 1))',
      'P = Intersect(l, conicC, 1)',
      'Q = Intersect(l, conicC, 2)',
    ].join('\n');
    expect(semanticCheck(text, { knownCommandLower: KNOWN }).failures).toEqual([]);
  });

  it('冒号命名的方程对滑块的引用计入依赖关系', () => {
    const text = 'b = Slider(0, 2, 0.1)\nl: x + y = b';
    const r = semanticCheck(text, { knownCommandLower: KNOWN });
    expect(r.failures).toEqual([]);
  });

  it('冒号命名方程中真正未定义的参数仍会报错', () => {
    const r = semanticCheck('conicC: x^2/2 - y^2 = t', { knownCommandLower: KNOWN });
    expect(r.failures).toEqual([
      expect.objectContaining({ check: 'free_param', detail: expect.stringContaining('t（被 conicC 引用）') }),
    ]);
  });

  it.each(['=', ':='])('保留 %s 定义和函数形参的识别', (separator) => {
    const text = `f(t) ${separator} t^2\nP = (1, f(1))`;
    expect(semanticCheck(text, { knownCommandLower: KNOWN }).failures).toEqual([]);
  });

  it.each(['MODE:2D', 'MODE:3D', ' mode : 3D'])('模式标记 %j 不算对象定义', (mode) => {
    expect(semanticCheck(`${mode}\nA = (0, 0)`, { knownCommandLower: KNOWN }).failures).toEqual([]);
  });

  it('没有类别也能查——动点自洽对画图与题目建模都适用', () => {
    const fp = semanticCheck('f = Function(t^2, -3, 3)\nP = (t, f(t))', { knownCommandLower: KNOWN });
    expect(fp.failures.some((f) => f.check === 'free_param')).toBe(true);
    const os = semanticCheck('f = Function(x^2, -3, 3)\ns = Slider(0, 1, 0.1)', { knownCommandLower: KNOWN });
    expect(os.failures.some((f) => f.check === 'orphan_slider')).toBe(true);
  });

  it('2026-10-15 移除的三条不再出现', () => {
    // no_text：纯画图写句说明是合理需求；何况按类别的门已拆，一律不报
    const text = 'A = Point(0, 0)\nnote = Text("这是重心")';
    expect(semanticCheck(text, { knownCommandLower: KNOWN }).failures.map((f) => f.check)).not.toContain('no_text');
    // category_structure：「画两个点」不该被要求"缺函数对象"
    const bare = 'A = Point(0, 0)\nB = Point(1, 1)';
    expect(semanticCheck(bare, { knownCommandLower: KNOWN }).failures.map((f) => f.check)).not.toContain('category_structure');
    // syntax：行级有效性已交给 catalog.ts 的 inspectLedger（会查签名），语义层不重复报
    const dirty = 'f = Function(x^2, -3, 3)\n@@@garbage###\n???another';
    expect(semanticCheck(dirty, { knownCommandLower: KNOWN }).failures.map((f) => f.check)).not.toContain('syntax');
  });
});
