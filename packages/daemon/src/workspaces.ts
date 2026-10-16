/**
 * 工作区布局 —— 数据目录下的 `<dataDir>/workspaces/<课件id>/`。
 *
 * **键是课件 id，不是窗口 id**。草稿是「当前画布的可编辑形态」，几何内容归课件所有；
 * 早期按窗口命名（窗口 id 是页面挂载时现生成的随机 UUID），于是每次启动应用就多一个
 * 目录、且没有任何代码删它们——实测攒了 21 个。
 *
 * 敢在这里放手删的理由：草稿**可再生**。载入课件时会重灌（`syncConstructionDraft`）、
 * 每次 apply 后又按画布真实内容回写（`tools.ts` 的 writeConstructionFile）。
 * 它从来不是存档。
 *
 * 前端侧的同名概念在 `math-mover-next/lib/server/workspace.ts`（agent 的 cwd 就是那个目录，
 * `--restricted` 把写入框在 cwd 里）。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 没有课件 id 时的兜底桶（绕过工作台直接打 HTTP 的调用会落这里）。 */
export const DEFAULT_WORKSPACE = '_default';

/** 目录名/头的取值域——与 daemon 对 windowId 的校验同一把尺子。 */
const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/;

export function workspacesRoot(root: string): string {
  return path.join(root, 'workspaces');
}

/**
 * 某个课件的工作区。课件 id 缺失或不合法一律落 `_default`——
 * 保证任何情况下都有合法落点，不引入第二套命名规则。
 */
export function workspaceDir(root: string, coursewareId?: string): string {
  const id = typeof coursewareId === 'string' ? coursewareId.trim() : '';
  return path.join(workspacesRoot(root), SAFE_ID.test(id) ? id : DEFAULT_WORKSPACE);
}

/** 永久删除课件时顺手回收它的工作区。失败不抛——由启动扫描兜底。 */
export function removeWorkspace(root: string, coursewareId: string): boolean {
  if (!SAFE_ID.test(coursewareId)) return false;
  try {
    fs.rmSync(workspaceDir(root, coursewareId), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** 目录条目，读不到就当空的（首次启动时 workspaces/ 尚不存在）。 */
function directories(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * daemon 启动时的孤儿扫描：删掉不属于任何在世课件的目录。
 *
 * 为什么此刻删是安全的：daemon 启动那一瞬间，按定义**不可能有窗口连着**，
 * 所以 `workspaces/` 下的一切要么是上次跑剩的、要么根本没人认领；而草稿可再生，
 * 即便删错，载入课件时会重灌回来。
 *
 * `liveIds` 应含**归档**课件——归档不是删除，它还活着。
 *
 * @returns 被删掉的目录名（供日志/测试观察）
 */
export function sweepWorkspaces(root: string, liveIds: Iterable<string>): string[] {
  const live = new Set(liveIds);
  const removed: string[] = [];
  const base = workspacesRoot(root);
  for (const name of directories(base)) {
    if (live.has(name)) continue;
    try {
      fs.rmSync(path.join(base, name), { recursive: true, force: true });
      removed.push(name);
    } catch {
      // 被占用/无权限：留着，下次启动再试。宁可漏删也不能让 daemon 起不来。
    }
  }
  return removed;
}

/**
 * 清掉更早方案的遗留目录 `windows/`。
 *
 * 那份布局（工作稿落在 `<dataDir>/windows/<窗口id>/`）已被 `workspaces/` 取代，
 * 全仓库没有任何代码再读它。文件是陈年草稿，可再生。
 */
export function removeLegacyWindowRoot(root: string): boolean {
  try {
    fs.rmSync(path.join(root, 'windows'), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
