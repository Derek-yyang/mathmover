import { describe, it, expect } from 'vitest';
import { parseCommands, classifyLine, detectMode } from '../src/parse.ts';

describe('classifyLine', () => {
  it('识别普通定义行', () => {
    expect(classifyLine('E = (0, 0)')).toEqual({ kind: 'definition', name: 'E' });
    expect(classifyLine('f = Line(A, B)')).toEqual({ kind: 'definition', name: 'f' });
  });

  it('识别带括号的函数定义', () => {
    expect(classifyLine('g = Function(x^2 / 4, -3, 3)')).toEqual({ kind: 'definition', name: 'g' });
    expect(classifyLine('f(x) = x^2')).toEqual({ kind: 'definition', name: 'f' });
  });

  it('冒号定义归为 colon-def，而不是 definition（现行 Python 在此误判）', () => {
    expect(classifyLine('A := (0,0)')).toEqual({ kind: 'colon-def', name: 'A' });
  });

  it('识别属性行及其目标对象', () => {
    expect(classifyLine('SetColor(f, "#FF0000")')).toEqual({ kind: 'property', name: 'f' });
    expect(classifyLine('ShowLabel(A, true)')).toEqual({ kind: 'property', name: 'A' });
    expect(classifyLine('SetLineThickness(g, 4)')).toEqual({ kind: 'property', name: 'g' });
  });

  it('识别注释、空行、MODE', () => {
    expect(classifyLine('  // 这是注释').kind).toBe('comment');
    expect(classifyLine('').kind).toBe('blank');
    expect(classifyLine('MODE:3D').kind).toBe('mode');
  });

  it('中文说明行归为 unknown（不可执行）', () => {
    expect(classifyLine('这是一个说明').kind).toBe('unknown');
  });
});

describe('parseCommands', () => {
  const LINES = [
    'MODE:2D',
    '',
    '// 构造点',
    'A = (0, 0)',
    'B = (3, 2)',
    'f = Line(A, B)',
    'SetColor(f, "#FF0000")',
    'A := (1,1)',
  ];

  it('保留 raw，另给归一化 text', () => {
    const { commands } = parseCommands(['  A = (0, 0)  ', 'B = (1, \\"2\\")']);
    expect(commands[0].raw).toBe('  A = (0, 0)  ');
    expect(commands[0].text).toBe('A = (0, 0)');
    // 反转义 \" → "
    expect(commands[1].text).toBe('B = (1, "2")');
  });

  it('executable 剔除注释/空行/MODE，dropped 收走它们', () => {
    const r = parseCommands(LINES);
    expect(r.executable.map((c) => c.raw)).toEqual([
      'A = (0, 0)',
      'B = (3, 2)',
      'f = Line(A, B)',
      'SetColor(f, "#FF0000")',
      'A := (1,1)',
    ]);
    expect(r.dropped.map((c) => c.kind)).toEqual(['mode', 'blank', 'comment']);
  });

  it('index 与源清单下标一致，便于 stable diff', () => {
    const r = parseCommands(LINES);
    expect(r.commands[3].index).toBe(3);
    expect(r.commands[3].raw).toBe('A = (0, 0)');
  });
});

describe('detectMode', () => {
  it('缺省 2D', () => {
    expect(detectMode(parseCommands(['A = (0,0)']).commands)).toBe('2D');
  });
  it('MODE:3D 覆盖', () => {
    expect(detectMode(parseCommands(['MODE:3D', 'A = (0,0,0)']).commands)).toBe('3D');
  });
  it('MODE:2D 明确 2D', () => {
    expect(detectMode(parseCommands(['MODE:2D', 'A = (0,0)']).commands)).toBe('2D');
  });
});

