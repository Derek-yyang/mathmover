# MathMover 标准画法库

本目录供应用的专家模型生成 GeoGebra 指令使用。专家 `SKILL.md` 定义本类题的职责和骨架，
`shared/sops/*.md` 提供可组合的局部构造，`shared/ggb-pitfalls.md` 收录引擎注意事项。
`expert_prompts.py` 将 `{{SOP:card-name}}` 原位展开，再追加坑手册；模型按题意选择分支。
这不是自动执行 SOP 的工作流，也不保证模型每次都采用示例。

## 覆盖范围

| 构造 | 卡片 |
|---|---|
| 开场、定点、样式与辅助对象 | view-setup、fixed-point、aux-line、hidden-helper |
| 几何关系、求交、垂足 | geometric-relations、intersection、projection-foot |
| 函数与圆锥曲线 | function-object、curve-definition、conic-features |
| 圆、弧、切线与切点 | circle-tangent |
| 一维/二维运动、派生点轨迹 | moving-point-function、moving-point-path、moving-point-region、locus |
| 多边形及区域 | closed-region |
| 三维建系、线框、平面、有限截面、旋转体 | 3d-frame、3d-edges、plane-helper、polyhedron-section、rotation-solid |

库有 21 张卡。每类专家只引用相关子集；新增卡片需同步专家引用，不盲目全量导入。
旧 `references/sops.md` 已移除，旧完整范文仅在 `_archived_walkthroughs_2026-10-07.md` 中留档。

## 写卡约定

每张卡保持简短的五部分：适用、前置、片段、边界、检查。

- 示例是实例，不是题目常量。数字、名字、范围必须按题意替换；优先复用已构造对象。
- 判断对象类型和自由度：独立/派生点、函数/圆锥曲线、路径/区域、无限/有限对象不能混用。
- 变体只收录不同构造分支；换个数字无需复制整张卡。前提不成立时明确停止或改选分支。
- 数学范围、展示窗口、初始位置分别说明，不为规避退化修改题意。
- 卡片不得嵌套 `{{SOP:...}}`。提及其他卡片的依赖须在相应专家显式导入。
- 不依赖“默认颜色”；主角、辅助、纯计算对象按用途设置样式与可见性。
- 每个 `ggb` 代码块前写唯一 `<!-- example: id -->`，并在 `scripts/sop_examples.json` 配前置指令和数学断言。

## 验证

在仓库根目录运行：

```powershell
.\.venv\Scripts\python.exe -B scripts\verify_sops.py
.\.venv\Scripts\python.exe -B scripts\test_sop_loader.py
```

第一项检查引用覆盖、正文展开、卡片依赖、示例与白名单；第二项检查热更新、引用变化、缺失/拼错引用和嵌套引用。
静态检查通过不等于 GeoGebra 执行成功。

生成独立浏览器验证页面，服务只暴露临时 QA 目录：

```powershell
.\.venv\Scripts\python.exe -B scripts\verify_sops.py --html-dir "$env:TEMP\mathmover-sop-qa"
.\.venv\Scripts\python.exe -B -m http.server 8766 --bind 127.0.0.1 --directory "$env:TEMP\mathmover-sop-qa"
```

打开 http://127.0.0.1:8766/，等两种视图就绪后运行。页面加载与产品同源的 GeoGebra 部署脚本，
检查定义对象是否存在/有定义，再检查几何关系和参数样本；属性命令的 false 不直接算失败。
测试不调用模型、不写用户历史、不读取凭据。结果可在页面或 `window.sopResults` 查看。

每次修改片段必须复跑；每个重要分支用位置/尺度/方向/参数变化检查。
多解、相切、退化、拓扑变化的边界说明不能用单个正常案例代替验证。
完整题目的读图、分支选择、漏对象和模型遵守率仍需另做生成回归；本库不声称覆盖任意数学题。

## 命令依据

采用 GeoGebra 代数视图命令，不能混用 CAS 的返回类型或虚构索引参数。

- [函数极值](https://geogebra.github.io/docs/manual/en/commands/Extremum/)、[零点](https://geogebra.github.io/docs/manual/en/commands/Root/)、[顶点](https://geogebra.github.io/docs/manual/en/commands/Vertex/)
- [求交](https://geogebra.github.io/docs/manual/en/commands/Intersect/)、[多结果元素](https://geogebra.github.io/docs/manual/en/commands/Element/)
- [焦点](https://geogebra.github.io/docs/manual/en/commands/Focus/)、[准线](https://geogebra.github.io/docs/manual/en/commands/Directrix/)
- [路径点](https://geogebra.github.io/docs/manual/en/commands/Point/)、[区域点](https://geogebra.github.io/docs/manual/en/commands/PointIn/)、[轨迹](https://geogebra.github.io/docs/manual/en/commands/Locus/)
- [平面](https://geogebra.github.io/docs/manual/en/commands/Plane/)、[法向定面](https://geogebra.github.io/docs/manual/en/commands/PerpendicularPlane/)
- [圆锥](https://geogebra.github.io/docs/manual/en/commands/Cone/)、[圆柱](https://geogebra.github.io/docs/manual/en/commands/Cylinder/)、[视图可见性](https://geogebra.github.io/docs/manual/en/commands/SetVisibleInView/)
