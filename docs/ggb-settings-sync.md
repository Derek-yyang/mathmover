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

当前本地 GeoGebra 5.4.931.2 在外部 API 修改网格后，有时不会更新已打开面板中的勾选。使用公开的 `setPerspective('-P')` / `setPerspective('+P')` 重进面板刷新，未修改运行库或通过私有 DOM 控制设置。该操作可能重建面板内的展开状态。

官方参考：[Apps API](https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/) 与 [SetPerspective](https://geogebra.github.io/docs/manual/en/commands/SetPerspective/)。注意接口编号不同：`getGraphicsOptions(-1)` 读取 3D，`setAxesVisible(3, ...)` / `setGridVisible(3, ...)` 操作 3D。

## 验收

- 单元测试：客户端事件格式、部分轴状态、3D 状态、事件合并、平移不触发设置读取、订阅清理与快照恢复隔离。
- 真画板浏览器验收：原生勾选和顶部按钮双向同步，原生关闭同步、2D 面板开关保留中心和缩放、样式保存后刷新恢复、完整快照优先于冲突的旧字段、居中保留样式、3D 按钮操作正确视图。
- 保存恢复验收使用隔离的课件 API 响应和真实本地 GeoGebra，未写入用户课件库，未调用付费 Agent。实际磁盘写入仍由既有 daemon 保存流程负责。
