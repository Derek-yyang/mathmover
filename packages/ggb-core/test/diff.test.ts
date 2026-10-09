import { describe, it, expect } from 'vitest';
import { diffCommands } from '../src/diff.ts';

const V1 = [
  'A = (0, 0)',
  'B = (3, 2)',
  'f = Line(A, B)',
  'g = Function(x^2 / 4, -3, 3)',
];

describe('diffCommands', () => {
  it('完全相同 → 无改动', () => {
    const r = diffCommands(V1, [...V1]);
    expect(r.entries).toEqual([]);
    expect(r.summary).toContain('完全相同');
  });

  it('识别修改：E 的参数变了', () => {
    const v2 = [...V1, 'E = Point(f, 0.4)'];
    const v3 = [...V1, 'E = Point(f, 0.75)'];
    const r = diffCommands(v2, v3);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ op: 'changed', name: 'E' });
    expect(r.entries[0].before).toContain('0.4');
    expect(r.entries[0].after).toContain('0.75');
  });

  it('识别新增与删除', () => {
    const r = diffCommands(V1, ['A = (0, 0)', 'f = Line(A, B)', 'C = (1, 4)']);
    const ops = r.entries.map((e) => `${e.op}:${e.name}`);
    expect(ops).toContain('added:C');
    expect(ops).toContain('removed:B');
    expect(ops).toContain('removed:g');
  });

  it('属性行归到它修饰的对象名下，而不是散成无名行', () => {
    const v2 = [...V1, 'SetColor(f, "#FF0000")'];
    const v3 = [...V1, 'SetColor(f, "#00FF00")'];
    const r = diffCommands(v2, v3);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].name).toBe('f');
    expect(r.entries[0].op).toBe('changed');
  });

  it('顺序变化不产生噪音（按对象名对齐，不按行号）', () => {
    const shuffled = ['g = Function(x^2 / 4, -3, 3)', 'B = (3, 2)', 'A = (0, 0)', 'f = Line(A, B)'];
    const r = diffCommands(V1, shuffled);
    expect(r.entries).toEqual([]);
  });

  it('注释/空行/MODE 不参与 diff', () => {
    const a = ['// 说明', 'A = (0, 0)', '', 'MODE:2D'];
    const b = ['A = (0, 0)'];
    expect(diffCommands(a, b).entries).toEqual([]);
    expect(diffCommands(a, b).unchangedCount).toBe(1);
  });

  it('summary 是一句话中文摘要，且列出关键对象名', () => {
    const v2 = [...V1, 'E = Point(f, 0.4)'];
    const v3 = [...V1, 'E = Point(f, 0.75)', 'SetColor(f, "#FF0000")'];
    const r = diffCommands(v2, v3);
    expect(r.summary).toMatch(/共 \d+ 处改动/);
    expect(r.summary).toContain('E');
    expect(r.summary).toContain('f');
  });

  it('大量改动时摘要截断到 6 项并标注总数', () => {
    const many = Array.from({ length: 10 }, (_, i) => `p${i} = (${i}, ${i})`);
    const r = diffCommands([], many);
    expect(r.entries).toHaveLength(10);
    expect(r.summary).toContain('等 10 项');
  });
});
