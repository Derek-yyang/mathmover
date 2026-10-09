import { describe, it, expect } from 'vitest';
import {
  auditConstruction,
  detectSliders,
  summarizeObjects,
  expectedNameOf,
  type GgbProbeApi,
} from '../src/probe.ts';

/** 测试替身：可编程对象表，模拟 applet 的探测面。 */
function fakeApi(objects: Record<string, { type: string; value: string; indep?: boolean }>): GgbProbeApi & {
  setValue: (n: string, v: number) => void;
} {
  const values: Record<string, number> = {};
  for (const [n, o] of Object.entries(objects)) if (o.type === 'numeric') values[n] = 2;
  return {
    getAllObjectNames: () => Object.keys(objects),
    getObjectType: (n) => objects[n]?.type ?? '?',
    getValueString: (n) => objects[n]?.value ?? '',
    getValue: (n) => values[n] ?? 0,
    isIndependent: (n) => objects[n]?.indep ?? false,
    setValue: (n, v) => { values[n] = v; },
  };
}

describe('expectedNameOf', () => {
  it('取定义行的对象名', () => {
    expect(expectedNameOf('E = (0, 0)')).toBe('E');
    expect(expectedNameOf('  A := (1,1)')).toBe('A');
    expect(expectedNameOf('f(x) = x^2')).toBe('f');
    expect(expectedNameOf('SetColor(f, "#f00")')).toBeNull();
    expect(expectedNameOf('// 注释')).toBeNull();
  });
});

describe('auditConstruction', () => {
  const LINES = ['A = (0, 0)', 'B = (3, 2)', 'f = Line(A, B)', 'E = Point(f, 0.5)'];

  it('全部建立且有值 → 无发现', () => {
    const api = fakeApi({
      A: { type: 'point', value: '(0, 0)' },
      B: { type: 'point', value: '(3, 2)' },
      f: { type: 'line', value: 'y = 0.667x' },
      E: { type: 'point', value: '(1.5, 1)' },
    });
    const r = auditConstruction(api, LINES);
    expect(r.findings).toEqual([]);
    expect(r.degraded).toBe(false);
  });

  it('case-01「假成功」：对象存在但值是 (?)，必须抓成 undefined', () => {
    // 真实事故：E = (Root(f,2,4), 0) 把点包成坐标，值是 (?, ?)
    // evalCommand 返回 true、对象名也在 —— 只查返回值会漏掉
    const api = fakeApi({
      A: { type: 'point', value: '(0, 0)' },
      B: { type: 'point', value: '(3, 2)' },
      f: { type: 'line', value: 'y = 0.667x' },
      E: { type: 'point', value: '(?, ?)' },
    });
    const r = auditConstruction(api, LINES);
    expect(r.undefinedObjs.map((x) => x.name)).toContain('E');
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it('对象名不存在 → missing', () => {
    const api = fakeApi({ A: { type: 'point', value: '(0, 0)' } });
    const r = auditConstruction(api, LINES);
    expect(r.missing.map((x) => x.name)).toEqual(expect.arrayContaining(['B', 'f', 'E']));
  });

  it('Root(f) 自动命名变体 name_1 视为已建立', () => {
    const api = fakeApi({
      g: { type: 'point', value: '(1, 1)' },   // g = Root(f) 会生成 g_1/g_2
      g_1: { type: 'point', value: '(2, 2)' },
    });
    const r = auditConstruction(api, ['g = Root(f)']);
    expect(r.missing).toEqual([]);
  });

  it('文字对象的 ? 不算未定义', () => {
    const api = fakeApi({ t: { type: 'text', value: 'x = ?' } });
    const r = auditConstruction(api, ['t = Text("x = ?")']);
    expect(r.undefinedObjs).toEqual([]);
  });

  it('getValueString 不可用 → degraded，跳过未定义检测但仍查 missing', () => {
    const api = fakeApi({ A: { type: 'point', value: '(0,0)' } });
    delete (api as Partial<GgbProbeApi>).getValueString;
    const r = auditConstruction(api, ['A = (0,0)', 'Z = (1,1)']);
    expect(r.degraded).toBe(true);
    expect(r.missing.map((x) => x.name)).toEqual(['Z']);
    expect(r.undefinedObjs).toEqual([]);
  });

  it('注释与属性行不参与体检（不会误报 missing）', () => {
    const api = fakeApi({ f: { type: 'line', value: 'y = x' } });
    const r = auditConstruction(api, ['// 注释', 'SetColor(f, "#f00")', 'f = Line(A,B)']);
    expect(r.findings).toEqual([]);
  });

  it('重复定义只体检一次', () => {
    const api = fakeApi({});
    const r = auditConstruction(api, ['A = (0,0)', 'A = (1,1)']);
    expect(r.missing.filter((x) => x.name === 'A')).toHaveLength(1);
  });
});

describe('summarizeObjects', () => {
  it('给出 name/type/value/independent', () => {
    const api = fakeApi({
      A: { type: 'point', value: '(0, 0)', indep: true },
      f: { type: 'line', value: 'y = x' },
    });
    const s = summarizeObjects(api);
    expect(s).toEqual([
      { name: 'A', type: 'point', value: '(0, 0)', independent: true },
      { name: 'f', type: 'line', value: 'y = x', independent: false },
    ]);
  });

  it('api 抛错时不炸，返回已有部分', () => {
    const api: GgbProbeApi = {
      getAllObjectNames: () => ['a', 'b'],
      getObjectType: (n) => { if (n === 'b') throw new Error('boom'); return 'point'; },
    };
    expect(summarizeObjects(api).map((o) => o.name)).toEqual(['a', 'b']);
    expect(summarizeObjects(api)[1].type).toBe('?');
  });
});

describe('detectSliders', () => {
  it('只收 numeric 且独立的对象', () => {
    const api = fakeApi({
      slider_t: { type: 'numeric', value: '2', indep: true },
      derived: { type: 'numeric', value: '5', indep: false },
      A: { type: 'point', value: '(0,0)', indep: true },
    });
    const s = detectSliders(api);
    expect(s.map((x) => x.name)).toEqual(['slider_t']);
    expect(s[0].value).toBe(2);
    expect(s[0].rangeIsDefault).toBe(true);   // applet 无 getMin/getMax/getStep
    expect(s[0].min).toBe(-10);
    expect(s[0].max).toBe(10);
  });

  it('applet 暴露范围时用真实范围', () => {
    const api = fakeApi({ t: { type: 'numeric', value: '2', indep: true } });
    (api as GgbProbeApi).getMin = () => 0;
    (api as GgbProbeApi).getMax = () => 5;
    (api as GgbProbeApi).getStep = () => 0.5;
    const s = detectSliders(api);
    expect(s[0]).toMatchObject({ min: 0, max: 5, step: 0.5, rangeIsDefault: false });
  });
});
