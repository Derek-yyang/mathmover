/**
 * 可执行解析 —— **命令注入防线**所在的模块。
 *
 * 为什么要这层：npm 全局装出来的是 `.cmd` 包装脚本，Node 的 spawn 无 shell 时
 * 拒绝跑 `.cmd`（EINVAL），开 `shell:true` 又把参数拼进命令行 → 命令注入。
 * 正解是抠出 shim 里真正被调用的入口，改成 `spawn(node, [jsEntry, ...args])`，
 * 参数始终走 argv 数组。
 *
 * 这里锁住三件事：① 能解析出正确入口与 prefixArgs；② **只接受落在 shim 目录内**
 * 的路径（否则 shim 里写个 `C:\Windows\System32\cmd.exe` 就被带跑了）；
 * ③ 未知命令返回 null 而不是瞎猜。
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clearResolveCache, resolveSpawnTarget } from '../src/resolve.ts';

const IS_WIN = process.platform === 'win32';
const dirs: string[] = [];

/** 造一个临时 bin 目录并把它插到 PATH 最前，让 rawWhich 找到我们的 fixture。 */
function fakeBin(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-resolve-test-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, body, 'utf-8');
    if (!name.endsWith('.cmd') && !name.endsWith('.bat')) fs.chmodSync(f, 0o755);
  }
  process.env.PATH = `${dir}${path.delimiter}${process.env.PATH ?? ''}`;
  clearResolveCache();
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    if (!dir.startsWith(path.join(os.tmpdir(), 'mm-resolve-test-'))) throw new Error('Unsafe cleanup');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  clearResolveCache();
});

describe('resolveSpawnTarget', () => {
  it('未知命令返回 null，不瞎猜', () => {
    expect(resolveSpawnTarget('mm-definitely-not-a-real-cli-xyz')).toBeNull();
  });

  it.runIf(IS_WIN)('.cmd shim 里的 .js 入口 → spawn node + 脚本路径', () => {
    const dir = fakeBin({
      'faketest.cmd': 'node "%dp0%\\faketest.js" %*\r\n',
      'faketest.js': 'console.log(1)\n',
    });
    const target = resolveSpawnTarget('faketest');
    expect(target).not.toBeNull();
    // 关键：command 是 node，脚本路径必须进 prefixArgs —— 丢了它等于 spawn 空 node
    expect(target!.command).toBe(process.execPath);
    expect(target!.prefixArgs).toEqual([path.join(dir, 'faketest.js')]);
    expect(target!.label).toBe('faketest');
  });

  it.runIf(IS_WIN)('.cmd shim 里的 .exe 入口 → 直接 spawn 该 exe', () => {
    const dir = fakeBin({
      'fakeexe.cmd': '"%dp0%\\sub\\fakeexe.exe" %*\r\n',
    });
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'fakeexe.exe'), '');
    const target = resolveSpawnTarget('fakeexe');
    expect(target).not.toBeNull();
    expect(target!.command).toBe(path.join(dir, 'sub', 'fakeexe.exe'));
    expect(target!.prefixArgs).toEqual([]);
  });

  it.runIf(IS_WIN)('拒绝 shim 目录之外的路径（防 shim 被拿来带跑系统命令）', () => {
    // shim 里写了个 shim 目录之外的绝对路径——不许被采纳
    fakeBin({
      'evil.cmd': '"C:\\Windows\\System32\\cmd.exe" %*\r\n',
    });
    const target = resolveSpawnTarget('evil');
    expect(target).not.toBeNull();
    // 兜底：只能用 .cmd 本身，绝不能把外来路径塞进 command
    expect(target!.command.toLowerCase()).not.toContain('cmd.exe');
    expect(target!.prefixArgs).toEqual([]);
  });

  it.runIf(IS_WIN)('shim 指向不存在的文件时不采纳', () => {
    fakeBin({
      'ghost.cmd': '"%dp0%\\missing.js" %*\r\n',
    });
    const target = resolveSpawnTarget('ghost');
    expect(target).not.toBeNull();
    expect(target!.prefixArgs).toEqual([]); // 没解析出 js 入口
  });
});
