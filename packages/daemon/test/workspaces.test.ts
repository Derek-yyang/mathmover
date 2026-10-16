/**
 * 工作区布局与孤儿回收。
 *
 * 背景：工作稿目录早期按**窗口 id** 命名，而窗口 id 是页面挂载时现生成的随机 UUID——
 * 于是每次启动应用就多一个目录，且没有任何代码删它们（实测攒了 21 个）。
 * 现在按**课件 id** 命名，并补上回收（见 src/workspaces.ts）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_WORKSPACE,
  removeLegacyWindowRoot,
  removeWorkspace,
  sweepWorkspaces,
  workspaceDir,
  workspacesRoot,
} from '../src/workspaces.ts';

const roots: string[] = [];
function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mathmover-workspaces-test-'));
  roots.push(root);
  return root;
}
/** 造一份草稿，返回它的目录——模拟 agent 真写过东西的工作区。 */
function draft(root: string, id: string, commands: string[] = ['A = (0, 0)']): string {
  const dir = workspaceDir(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'construction.ggb.txt'), commands.join('\n') + '\n', 'utf8');
  return dir;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(path.join(os.tmpdir(), 'mathmover-workspaces-test-'))) throw new Error('Unsafe cleanup');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('工作区布局', () => {
  it('按课件 id 落目录；缺失或不合法一律落 _default', () => {
    const root = makeRoot();
    expect(workspaceDir(root, 'abc-123')).toBe(path.join(workspacesRoot(root), 'abc-123'));
    expect(workspaceDir(root)).toBe(path.join(workspacesRoot(root), DEFAULT_WORKSPACE));
    expect(workspaceDir(root, '')).toBe(path.join(workspacesRoot(root), DEFAULT_WORKSPACE));
    // 这个值要当目录名用——越界的一律兜底，绝不拼出 root 之外的路径
    expect(workspaceDir(root, '../../escape')).toBe(path.join(workspacesRoot(root), DEFAULT_WORKSPACE));
    expect(workspaceDir(root, 'a/b')).toBe(path.join(workspacesRoot(root), DEFAULT_WORKSPACE));
  });
});

describe('孤儿回收', () => {
  it('只删不属于在世课件的目录——归档课件保留', () => {
    const root = makeRoot();
    const live = draft(root, 'live-1');
    const archived = draft(root, 'archived-1');
    const orphan = draft(root, 'window-uuid-from-old-scheme');
    const fallback = draft(root, DEFAULT_WORKSPACE);

    // liveIds 应同时含在世与归档——归档不是删除，课件还活着
    const removed = sweepWorkspaces(root, ['live-1', 'archived-1']);

    expect(removed.sort()).toEqual([DEFAULT_WORKSPACE, 'window-uuid-from-old-scheme'].sort());
    expect(fs.existsSync(live)).toBe(true);
    expect(fs.existsSync(archived)).toBe(true);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(fallback)).toBe(false);
  });

  it('workspaces/ 不存在时也不炸（首次启动）', () => {
    expect(sweepWorkspaces(makeRoot(), [])).toEqual([]);
  });

  it('回收单个课件的工作区；非法 id 不动手', () => {
    const root = makeRoot();
    const dir = draft(root, 'gone-1');
    expect(removeWorkspace(root, 'gone-1')).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
    // 非法 id 不该拼出路径去删
    expect(removeWorkspace(root, '../../escape')).toBe(false);
  });

  it('清掉旧布局 windows/', () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, 'windows', 'some-window'), { recursive: true });
    expect(removeLegacyWindowRoot(root)).toBe(true);
    expect(fs.existsSync(path.join(root, 'windows'))).toBe(false);
  });
});
