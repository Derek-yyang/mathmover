# MathMover 标准画法库

本目录供应用的专家模型生成 GeoGebra 指令使用。四份 `SKILL.md` 完整指导模型如何把
本类题的条件、参数与关系按标准作图步骤转化为构造；`shared/sops/*.md` 提供具体写法参考，
通过正文中的 `{{SOP:card-name}}` 嵌入对应步骤。
`shared/generation-rules.md` 统一输出约定，`shared/ggb-pitfalls.md` 保留生成时的执行注意。
skill 的编号流程始终完整加载，模型仍直接读取原题文字/图片；按题跳过无关分支，
输入对象及其依赖可提前建立。SOP 是当前步骤的写法参考，按题取用片段。

## 按题装配

`shared/sop-index.json` 独立维护卡片能力摘要、视图兼容、必要依赖及四类完整参考集。
LLM 路由在原有分类调用中同时输出 `sops` 和 `sop_uncertain`，不新增一次模型调用。
`expert_prompts.assemble_expert_prompt(category, router_output)` 校验选择、补齐依赖并装配：

```text
共同输出约定 + 完整专家步骤（相关 SOP 原位展开）+ 补充参考（若有）+ 执行注意
```

- view-setup、fixed-point、hidden-helper 为常驻写法；其他卡片按题选择。
- skill 在相应步骤写独占一行的 `{{SOP:card-name}}`，装配时只展开已选中及必要依赖
  卡片；未选中引用移除，该步骤的操作、分支和完成检查仍保留。卡片原文件只维护一份。
- 四类默认完整参考集在各自 skill 中均有插入位置。合法的跨类别额外卡片若无对应位置，
  放在末尾的“补充写法参考”中，不遗漏或重复展开。卡片标题降为步骤下的三级标题。
- 选择不限于类别默认集，视图兼容的跨类别能力可以组合。依赖只表示必要的写法支撑；
  提到某命令不意味着必须加载整张关联卡，例如已有曲线的焦点提取不强制再次定义曲线。
- 仅信任类别匹配、`sop_uncertain=false` 且非空合法列表的结构化结果。旧格式、
  不确定、未知名称或视图不兼容时整体回退该类别完整集，不静默丢掉错误项。
- Perplexity Decisions 当前只返回类别，因此使用完整参考集，不额外调 LLM 选卡。
- 原有语法/语义纠错若触发，使用完整参考集并保留首次选中的跨类别卡片重新生成；
  重试上限不变。
- `EXPERT_PROMPTS[category]` / `load_expert_prompt(category)` 保留完整参考接口。
  文件改动下次装配即可生效；旧接口的缓存覆盖 skill、索引、公共规则、卡片和执行注意。
- `classified` 与 `completed` 事件的 `prompt` 字段记录模式、原因、卡片和字符数。
  `characters` 是装配正文长度，`system_characters` 含命令名单，`input_characters`
  还含用户文字；均不含图片或适配器消息包装，也不是 token 数。
  `retry_reference_mode=full` 表示纠错扩大了参考范围。
  `inline_cards` 记录按正文顺序嵌入的卡片，`extra_cards` 记录补充参考。

漏选一个合法卡片不一定能被结构校验发现；当前回退只覆盖可检测错误。选卡效果和最终
数学正确性须用实际题目验证，不能凭 prompt 缩短或语法通过推断。

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

库有 21 张卡。四类完整参考集分别为 14 / 12 / 15 / 16 张；新增卡片需同步独立索引，
至少纳入一类完整参考集，并在该类 skill 的适当步骤添加插入位置，校验视图和必要依赖。
旧 `references/sops.md` 已移除，指令写法只维护于 `shared/sops/`。

## 写卡约定

每张卡保留三部分：输入对象、指令片段、写法注意。题型判断、方案选择、数学条件
推导、运动自由度与整体检查写在对应 skill 中。

- 示例是实例，不是题目常量。数字、名字、范围必须按题意替换；优先复用已构造对象。
- 写法注意只保留影响复用/执行的参数含义、输入类型、结果承接、顺序和必要限制。
- 变体只收录不同写法；换数字无需复制整张卡。不把完整题目的解题流程放进卡片。
- 只有 skill 可写 `{{SOP:...}}`，引用须独占一行、名称合法且无重复；卡片正文不得
  嵌套引用。必要依赖放独立索引，插入位置放在 skill 相应步骤，避免重复存放卡片正文。
- 不依赖“默认颜色”；主角、辅助、纯计算对象按用途设置样式与可见性。
- 每个 `ggb` 代码块前写唯一 `<!-- example: id -->`，并在 `scripts/sop_examples.json` 配前置指令和数学断言。

## 验证

在仓库根目录运行：

```powershell
.\.venv\Scripts\python.exe -B scripts\verify_sops.py
.\.venv\Scripts\python.exe -B scripts\test_sop_loader.py
.\.venv\Scripts\python.exe -B scripts\test_prompt_pipeline.py
.\.venv\Scripts\python.exe -B scripts\test_command_catalog.py
```

第一项检查索引与插入位置覆盖、完整装配、依赖、示例与白名单；第二项检查原位展开、
完整步骤保留、补充参考、选择、回退、热更新及编写错误；第三项用模拟适配器检查选卡、路由重试、纠错扩大参考集
和决策路由兼容；第四项检查命令目录。上述命令不调用模型。
静态检查通过不等于 GeoGebra 执行成功。

生成独立浏览器验证页面，服务只暴露临时 QA 目录：

```powershell
.\.venv\Scripts\python.exe -B scripts\verify_sops.py --html-dir "$env:TEMP\mathmover-sop-qa"
.\.venv\Scripts\python.exe -B -m http.server 8766 --bind 127.0.0.1 --directory "$env:TEMP\mathmover-sop-qa"
```

打开 http://127.0.0.1:8766/，等两种视图就绪后运行。页面加载与产品同源的 GeoGebra 部署脚本，
检查定义对象是否存在/有定义，再检查几何关系和参数样本。
只对目录中明确列出的属性/脚本命令容忍 false；视图开场从相反状态执行，并断言实际坐轴/网格状态。
额外 14 个命令案例核对新命令、别名、空间重载、标签、锁定和线宽。
测试不调用模型、不写用户历史、不读取凭据。结果可在页面或 `window.sopResults` 查看。

每次修改片段必须复跑；每个重要分支用位置/尺度/方向/参数变化检查。
多解、相切、退化、拓扑变化的边界说明不能用单个正常案例代替验证。
完整题目的读图、分支选择、漏对象和模型遵守率仍需另做生成回归；本库不声称覆盖任意数学题。

## 命令依据

`ggb_commands.json` 是输入栏命令目录，不收录 JavaScript API 方法。
2d 分组表示二维可用的构造；3d 分组表示额外空间构造，空间专家同时获得通用组。
旧引擎名称保留在 aliases，模型提示使用规范英文名。SetSeed 为全局状态命令，不能作为对象属性重排。

signatures 当前覆盖 66 个常用命令族，并为各重载保存参数类型、结果族及官方来源。
静态检查只拒绝已核实的参数数量、视图或明确类型不匹配；未知表达式类型、多结果细节和几何存在性由引擎判断。
未收录签名的命令仅做名称检查，不表示其全部重载已经验证。
数学表达式与用户定义函数不当作未知命令；独立行、赋值右侧、列表和嵌套位置的未知命令统一记录并保留。

已确认的 API 混用或非法调用会被反馈给模型并从下发指令中剔除；一条明确的命令错误也触发修正，
不因整体有效率高而忽略。最终接口的 validation 返回最终文本的 unknown_commands 和 command_errors。
目录按 mtime 刷新，prompt 与解析器同源；文件缺失/损坏时明确报错，不偷偷回退到另一份旧名单。

新增命令时核对官方命令源码及目标 Applet；核实重载后才加入 signatures，
并新增生产解析器回归和引擎属性/数学断言。不要只加一个名称就宣布可用。

采用 GeoGebra 代数视图命令，不能混用 CAS 的返回类型或虚构索引参数。

- [函数极值](https://geogebra.github.io/docs/manual/en/commands/Extremum/)、[零点](https://geogebra.github.io/docs/manual/en/commands/Root/)、[顶点](https://geogebra.github.io/docs/manual/en/commands/Vertex/)
- [求交](https://geogebra.github.io/docs/manual/en/commands/Intersect/)、[多结果元素](https://geogebra.github.io/docs/manual/en/commands/Element/)
- [焦点](https://geogebra.github.io/docs/manual/en/commands/Focus/)、[准线](https://geogebra.github.io/docs/manual/en/commands/Directrix/)
- [路径点](https://geogebra.github.io/docs/manual/en/commands/Point/)、[区域点](https://geogebra.github.io/docs/manual/en/commands/PointIn/)、[轨迹](https://geogebra.github.io/docs/manual/en/commands/Locus/)
- [平面](https://geogebra.github.io/docs/manual/en/commands/Plane/)、[法向定面](https://geogebra.github.io/docs/manual/en/commands/PerpendicularPlane/)
- [圆锥](https://geogebra.github.io/docs/manual/en/commands/Cone/)、[圆柱](https://geogebra.github.io/docs/manual/en/commands/Cylinder/)、[视图可见性](https://geogebra.github.io/docs/manual/en/commands/SetVisibleInView/)
