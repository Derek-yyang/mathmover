/**
 * 拦掉**工作稿同步**的 HTTP 落点。
 *
 * 验证脚本都在浏览器里把 `/api/coursewares` 换成假数据——那些课件**只存在于假响应里**，
 * 从没进过真数据库。但 `/api/construction` 一直没拦，而载入课件时页面会把指令同步进
 * 工作稿（`syncConstructionDraft`），于是**真的**在用户数据目录下建了
 * `workspaces/<夹具id>/` 并写进一份草稿。
 *
 * 后果：那个 id 不是任何在世课件，删也删不掉（没有东西可删），只能等 daemon 下次
 * 启动扫描清掉。实测在数据目录里留下一份 8 字节的 `A=(1,2)`。
 *
 * 这里把落点换成纯内存：验证跑完，数据目录保持干净。
 *
 * @param page      Playwright 的 page
 * @param commands  初始草稿（夹具课件的指令），可选
 */
export async function stubConstructionDraft(page, { commands = [] } = {}) {
  let draft = [...commands];
  await page.route('**/api/construction**', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      if (Array.isArray(body?.commands)) draft = body.commands;
      // 真 daemon 返回 { file }；这里只需要形状对得上
      return route.fulfill({ json: { file: '(fixture) construction.ggb.txt' } });
    }
    return route.fulfill({ json: draft });
  });
}
