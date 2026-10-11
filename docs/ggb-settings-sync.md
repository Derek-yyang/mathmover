# 画板设置联动

MathMover 保留 GeoGebra 的原生设置面板；顶部只提供坐标轴、网格、画板设置和居中等常用入口，不另做一份高级设置表单。

## 用户行为

- “画板设置”按钮打开或关闭原生面板。右键打开、面板内关闭也会同步按钮状态。
- 坐标轴和网格按钮读取画板真实状态。只显示部分坐标轴时，XY 按钮使用部分开启样式；再次点击显示全部，再次点击隐藏全部。
- 2D 操作 x、y；3D 操作 x、y、z。3D 的按钮使用带视图编号的 API，不修改隐藏的 2D 视图。
- 2D 面板展开、关闭及窗口变化保留当前视图中心和每像素的世界单位。居中只移动视图，不重置颜色、间距等样式。

## 状态与保存

`lib/ggb-graphics-state.ts` 读取 `getGraphicsOptions` 和 `getPerspectiveXML`，兼容本地运行库的数组客户端事件与对象事件。订阅合并同一批事件，只在实际设置变化时更新；单纯平移不会反复读取整份设置。

`hooks/useGgbGraphics.ts` 负责顶部按钮；`GeoGebraBoard.tsx` 处理原生面板导致的内部绘图区尺寸变化；`useGgbSession.ts` 同步 2D/3D 模式；`useCoursewareLibrary.ts` 将设置变化接入原有自动保存。

完整 `.ggb` 快照是画板设置的正式来源，保留各轴开关、网格类型、颜色、粗细、间距和视图范围。恢复完整快照后不再叠加旧的 `view.showAxes/showGrid/bounds`；只有无快照的旧课件使用这些兼容字段。恢复期间的尺寸事件不能将上一课件的中心套到新课件。

仍沿用课件库既有规则：没有消息或构造对象的空白新课件不会仅因调整设置而创建记录；本地服务不可用时不能宣称设置已落盘。此功能没有改变数据库格式、Agent 协议或保存接口。

## 运行库兼容

当前本地 GeoGebra 5.4.931.2 在外部 API 修改网格后，有时不会更新已打开面板中的勾选。原有 `setPerspective('-P')` / `setPerspective('+P')` 刷新会让 Settings 每次缩窄 8px；禁用坐标补偿或关开之间等待两帧仍可复现，只改轴／网格而不重进则宽度不变。

第一版保存并回放打开状态的布局 XML，只验证了宽度和设置值，遗漏了正文可见性。GeoGebra 还有覆盖式 Settings：面板显示时根分隔比例仍为 1。回放这种打开状态的布局可以使正文宽度变成 0，不能把它当成正常左右分栏处理，也不能用 XML 代替原生打开流程。

现在由 `lib/ggb-settings-refresh.ts` 在关闭前读取实际面板宽度，执行 `-P`，读取关闭状态的布局，只把隐藏的 Properties 视图（4097）的 `size` 设置为原宽度加 8px 分隔条，然后回放关闭布局，最后执行原生 `+P`。不回放打开状态的 XML，也不改写根分隔比例；原生重开时扣除分隔条后保留原宽。`+P` 放在 `finally`，读取或回放失败也不能把面板留在关闭状态。

`GeoGebraBoard` 按实例注册面板宽度读取函数，卸载时清理；只读取 DOM 几何尺寸，不通过私有 DOM 修改设置，也未修改运行库。快速连点时，DOM 尚未重新挂载导致的 0px 使用本次实例最近一次有效宽度；没有有效尺寸的未知实例跳过刷新。刷新仍可能重建面板内的展开状态；没有引入异步重开，也不屏蔽原有视图中心／缩放补偿。8px 补偿针对固定的 5.4.931.2 运行库，升级运行库时须重跑真画板验收。

官方参考：[Apps API](https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/) 与 [SetPerspective](https://geogebra.github.io/docs/manual/en/commands/SetPerspective/)。注意接口编号不同：`getGraphicsOptions(-1)` 读取 3D，`setAxesVisible(3, ...)` / `setGridVisible(3, ...)` 操作 3D。

## 验收

- 单元测试：客户端事件格式、部分轴状态、3D 状态、事件合并、平移不触发设置读取、订阅清理与快照恢复隔离。
- 真画板浏览器验收：原生勾选和顶部按钮双向同步，原生关闭同步、2D 面板开关保留中心和缩放、样式保存后刷新恢复、完整快照优先于冲突的旧字段、居中保留样式、3D 按钮操作正确视图。
- 保存恢复验收使用隔离的课件 API 响应和真实本地 GeoGebra，未写入用户课件库，未调用付费 Agent。实际磁盘写入仍由既有 daemon 保存流程负责。
- 单元回归：`node --test tests/ggb-settings-refresh.test.mjs tests/ggb-graphics-state.test.mjs tests/dashboard-resize.test.mjs`；包括覆盖式／分栏式关闭布局保留、原生打开调用顺序、错误时仍打开、快速连点缓存宽度及实例清理。
- 浏览器回归：`node scripts/verify-settings-visibility.mjs`（仓库根目录）。隔离课件接口并运行真实 GeoGebra，检查面板位置、正文可见性、命中测试、原生控件实际点击和勾选同步，不能只检查 XML 的 visible 字段或外框宽度。截图输出到 `spike-out/settings-visibility/`，未写入实际课件库、未调用 Agent。
- 2026-10-11 修正版验收：1544px、2400px 视口各完成 12 次逐次点击及 20 次快速连点，2D 面板保持 392px，正文可见且原生勾选可操作；3D 连续点击 8 次保持 384px，正文与勾选同步正常。页面无脚本错误，2D／3D 截图已检查。18 项相关单元测试、TypeScript 与定向 ESLint 通过。
