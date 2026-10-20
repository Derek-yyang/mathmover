/**
 * 往 Composer 里塞题目图片 —— 走**用户的真实路径**：点「添加题目图片」→ 文件对话框。
 *
 * 为什么不 `setInputFiles('input[type=file]')`：上传入口换成库的
 * `ComposerPrimitive.AddAttachment` 之后，那个 input 是**点击时临时造出来**的
 * （挂在 body 上，选完即摘），DOM 里没有常驻节点可以定位。`filechooser` 是
 * Playwright 对「点按钮 → 选文件」的官方支持，也更贴近真实路径：按钮被禁用、
 * 点了不弹对话框这类回归，它会直接失败。
 *
 * @param page  Playwright 的 page
 * @param files 单个文件描述对象或数组（与 `FileChooser.setFiles` 同形）
 */
export async function uploadImages(page, files) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '添加题目图片', exact: true }).click(),
  ]);
  await chooser.setFiles(files);
}
