import assert from 'node:assert/strict';

/** Isolated sidebar fixture: never writes the user's library or model settings. */
export async function setupOrganizationFixture(page) {
  const now = new Date().toISOString();
  const records = new Map(Array.from({ length: 9 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    return [id, { id, title: ['椭圆与焦点', '三棱锥外接球', '抛物线研究'][index] ?? `示例课件 ${index + 1}`,
      created_at: now, updated_at: now, revision: 1, archived_at: null, pinned_at: null, project_id: null,
      commands: [], messages: [], view: { showAxes: true, showGrid: true } }];
  }));
  const projects = new Map();
  const errors = []; const writes = [];
  let failOrganization = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/agent**', route => route.fulfill({ json: { runtimes: [] } }));
  await page.route('**/api/byok', route => route.fulfill({ json: { apiKeyConfigured: false } }));
  await page.route('**/api/coursewares**', async route => {
    const request = route.request(); const url = new URL(request.url());
    const parts = url.pathname.split('/').slice(3);
    if (parts[0] === 'windows') return route.fulfill({ json: { bindingToken: 'fixture' } });
    if (request.method() === 'GET') {
      if (!parts.length) return route.fulfill({ json: { records: [...records.values()], projects: [...projects.values()],
        capabilities: { archive: true, permanentDelete: true, organization: true }, dataDirectory: 'fixture' } });
      return route.fulfill({ json: records.get(parts[0]) ?? {} });
    }
    const body = request.postDataJSON(); writes.push({ parts, body });
    if (parts[0] === 'projects') {
      if (parts.length === 1) {
        const project = { id: `project-${projects.size + 1}`, name: body.name, created_at: now, revision: 1 };
        projects.set(project.id, project);
        if (body.coursewareId) records.get(body.coursewareId).project_id = project.id;
        return route.fulfill({ json: project });
      }
      const project = projects.get(parts[1]);
      if (parts[2] === 'rename') Object.assign(project, { name: body.name, revision: project.revision + 1 });
      else { projects.delete(project.id); for (const record of records.values()) if (record.project_id === project.id) record.project_id = null; }
      return route.fulfill({ json: project });
    }
    if (parts[1] === 'organize') {
      if (failOrganization) return route.fulfill({ status: 503, json: { error: '整理失败测试' } });
      const record = records.get(parts[0]);
      if ('pinned' in body) record.pinned_at = body.pinned ? now : null;
      if ('projectId' in body) record.project_id = body.projectId;
      return route.fulfill({ json: record });
    }
    if (parts[1] === 'archive' || parts[1] === 'unarchive') {
      const record = records.get(parts[0]); record.archived_at = parts[1] === 'archive' ? now : null; record.revision++;
      return route.fulfill({ json: record });
    }
    if (parts[0] === 'delete') { body.ids.forEach(id => records.delete(id)); return route.fulfill({ json: { ok: true } }); }
    // A blank board should not save. Block unexpected writes instead of touching live data.
    return route.fulfill({ status: 400, json: { error: 'Unexpected fixture write' } });
  });
  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '新建项目', exact: true }).waitFor();
  return { records, projects, errors, writes, setFail: value => { failOrganization = value; } };
}

export async function verifyOrganizationFlow(page, fixture) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const section = label => page.locator('[data-slot="courseware-section"]').filter({ has: page.getByRole('button', { name: label, exact: true }) }).first();
  const row = (title, parent = page) => parent.locator('[data-slot="aui_thread-list-item"]').filter({ has: page.getByText(title, { exact: true }) }).first();
  const menu = async (title, parent) => { const target = row(title, parent); await target.hover(); await target.getByRole('button', { name: '课件操作' }).click(); };
  await menu('椭圆与焦点'); await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
  await section('置顶').getByText('椭圆与焦点', { exact: true }).waitFor();
  assert.equal(fixture.records.values().next().value.revision, 1);
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('textbox', { name: '项目名称' }).fill('解析几何');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await menu('椭圆与焦点', section('置顶'));
  await page.getByRole('menuitem', { name: '移动到项目', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '解析几何', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  const project = page.locator('[data-slot="courseware-project"]').filter({ has: page.getByRole('button', { name: '解析几何', exact: true }) });
  await project.getByText('椭圆与焦点', { exact: true }).waitFor();
  await project.getByRole('button', { name: '解析几何', exact: true }).click();
  assert.equal(await project.getByRole('button', { name: '解析几何', exact: true }).getAttribute('aria-expanded'), 'false');
  const search = page.getByRole('searchbox', { name: '搜索课件标题' });
  await search.fill('椭圆');
  assert.equal(await project.getByRole('button', { name: '解析几何', exact: true }).getAttribute('aria-expanded'), 'true');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.getByRole('button', { name: '全选结果', exact: true }).click();
  assert.match(await page.locator('[data-slot="thread-list-selection-bar"]').innerText(), /已选 1 项/);
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await search.fill('');
  await project.getByRole('button', { name: '解析几何', exact: true }).click();
  await project.hover(); await project.getByRole('button', { name: '解析几何的项目操作' }).click();
  await page.getByRole('menuitem', { name: '重命名项目', exact: true }).click();
  await page.getByRole('textbox', { name: '项目名称' }).fill('圆锥曲线');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '圆锥曲线', exact: true }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await section('置顶').getByText('椭圆与焦点', { exact: true }).waitFor();
  const renamed = page.locator('[data-slot="courseware-project"]').filter({ has: page.getByRole('button', { name: '圆锥曲线', exact: true }) });
  await renamed.getByText('椭圆与焦点', { exact: true }).waitFor();
  // Failure stays in the dialog and permits retry.
  await menu('三棱锥外接球'); await page.getByRole('menuitem', { name: '移动到项目', exact: true }).click();
  fixture.setFail(true);
  await page.getByRole('dialog').getByRole('button', { name: '圆锥曲线', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '整理失败测试' }).waitFor();
  fixture.setFail(false);
  await page.getByRole('dialog').getByRole('button', { name: '圆锥曲线', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await renamed.getByText('三棱锥外接球', { exact: true }).waitFor();
  assert.equal(fixture.errors.length, 0, fixture.errors.join('\n'));
  return { pinned: true, projectCreated: true, moved: true, renamed: true, reload: true, searchExpands: true, selectionDeduplicated: true, failureRetry: true };
}

export async function verifyOrganizationDeletion(page, fixture) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const project = page.locator('[data-slot="courseware-project"]').filter({ has: page.getByRole('button', { name: '圆锥曲线', exact: true }) });
  await project.hover(); await project.getByRole('button', { name: '圆锥曲线的项目操作' }).click();
  await page.getByRole('menuitem', { name: '删除项目', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除项目', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await project.waitFor({ state: 'detached' });
  assert.equal(fixture.records.size, 9);
  assert.ok([...fixture.records.values()].every(record => record.project_id === null));
  const pinned = page.locator('[data-slot="courseware-section"]').filter({ has: page.getByRole('button', { name: '置顶', exact: true }) }).first();
  const row = pinned.locator('[data-slot="aui_thread-list-item"]').first();
  await row.hover(); await row.getByRole('button', { name: '课件操作' }).click();
  await page.getByRole('menuitem', { name: '取消置顶', exact: true }).click();
  await pinned.waitFor({ state: 'detached' });
  assert.equal(fixture.errors.length, 0, fixture.errors.join('\n'));
  return { projectDeletedWithoutCoursewareLoss: true, unpinned: true, errors: fixture.errors };
}
