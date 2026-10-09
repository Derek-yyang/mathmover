# MathMover 标准画法库

本目录供应用的专家模型生成 GeoGebra 指令使用。四份 `SKILL.md` 完整指导模型如何把
本类题的条件、参数与关系按标准作图步骤转化为构造；`shared/sops/*.md` 提供具体写法参考，
通过正文中的 `{{SOP:card-name}}` 嵌入对应步骤。
`shared/generation-rules.md` 统一精简输出约定；命令的使用条件与易错写法保留在对应 SOP。
skill 的编号流程始终完整加载，模型仍直接读取原题文字/图片；按题跳过无关分支，
输入对象及其依赖可提前建立。SOP 是当前步骤的写法参考，按题取用片段。

## Prompt 装配

路由只确定专家类别。`expert_prompts.assemble_expert_prompt(category)` 读取对应 skill，
将其中全部 `{{SOP:card-name}}` 替换为卡片正文。卡片集合和插入位置只由 skill 决定。

```text
精简公共约定 + 完整专家步骤（全部引用的 SOP 原位展开）+ 命令白名单
```

装配器生成前两部分，`app.py` 随后追加同源命令白名单与用户说明；图片作为独立输入发送。

- skill 在相应编号步骤写独占一行的 `{{SOP:card-name}}`。卡片标题降为步骤下的三级标题，
  完整步骤及示例指令保留。模型按题跳过无关分支、取用所需片段。
- 四份 skill 都明确引用视图、定点和隐藏辅助写法；没有另设常驻卡列表。
- 跨类别能力通过在该 skill 的合适步骤直接引用同一张卡片复用，不复制卡片正文，
  不由路由临时添加卡片。所需支撑写法同样在 skill 中直接引用并按对象依赖安排位置。
- 引用缺失、重复、格式错误、位于编号步骤外或卡片含嵌套引用时明确报错。
- LLM 和 Perplexity Decisions 路由都只分类；同一类别装配相同的专家正文。
- 语法/语义校验只做清洗与遥测，不回灌重试（2026-10-08 移除：整代重试耗时且
  掩盖 prompt 短板，质量改进回到 prompt/SOP 源头）。
- `EXPERT_PROMPTS[category]` / `load_expert_prompt(category)` 保留完整参考接口。
  文件改动下次装配即可生效；旧接口的缓存覆盖 skill、公共规则和该 skill 引用的卡片。
- `classified` 与 `completed` 事件的 `prompt` 字段记录完整加载模式、卡片和字符数。
  `characters` 是装配正文长度，`system_characters` 含命令名单，`input_characters`
  还含用户文字；均不含图片或适配器消息包装，也不是 token 数。
  `cards` 按 skill 中的引用顺序记录已展开卡片。

数学正确性须用实际题目验证，不能凭 prompt 长度或语法通过推断。

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

库有 21 张卡。四类 skill 分别引用 14 / 12 / 15 / 16 张；新增卡片只需创建卡片文件，
并在适用 skill 的相应步骤添加引用，核对视图兼容和所需支撑写法。
旧 `references/sops.md` 已移除，指令写法只维护于 `shared/sops/`。

## 写卡约定

每张卡保留三部分：输入对象、指令片段、写法注意。题型判断、方案选择、数学条件
推导、运动自由度与整体检查写在对应 skill 中。

- 示例是实例，不是题目常量。数字、名字、范围必须按题意替换；优先复用已构造对象。
- 写法注意只保留影响复用/执行的参数含义、输入类型、结果承接、顺序和必要限制。
- 变体只收录不同写法；换数字无需复制整张卡。不把完整题目的解题流程放进卡片。
- 只有 skill 可写 `{{SOP:...}}`，引用须独占一行、名称合法且无重复；卡片正文不得
  嵌套引用。引用列表与插入位置统一放在 skill 相应步骤，避免重复配置与卡片正文。
- 不依赖“默认颜色”；主角、辅助、纯计算对象按用途设置样式与可见性。
- 每个 `ggb` 代码块前写唯一 `<!-- example: id -->`，并在 `scripts/sop_examples.json` 配前置指令和数学断言。

## 验证

模型请求默认不主动指定输出 token 上限，使用服务商默认值；不因长度上限、空正文或
incomplete 状态自动提额重试，也不自动设置思考力度。`config.json` 的 `max_tokens`
为空表示不传，正整数表示显式上限；供应商切换脚本没有隐式默认值。
Anthropic 原生 Messages 协议要求 `max_tokens`，使用该协议时需显式配置；未配置则
明确报错，不补默认额度。图片载荷与网络错误的原有处理保持独立。

在仓库根目录运行：

```powershell
.\.venv\Scripts\python.exe -B scripts\verify_sops.py
.\.venv\Scripts\python.exe -B scripts\test_sop_loader.py
.\.venv\Scripts\python.exe -B scripts\test_prompt_pipeline.py
.\.venv\Scripts\python.exe -B scripts\test_command_catalog.py
.\.venv\Scripts\python.exe -B scripts\test_model_output_limits.py
```

第一项检查引用覆盖、完整装配、示例与白名单；第二项检查原位展开、完整步骤保留、
卡片复用、引用变更与热更新及编写错误；第三项用模拟适配器检查分类、路由解析重试、
校验不重试（无效行剔除、语义失败仅上报）
和决策路由兼容；第四项检查命令目录。上述命令不调用模型。
第五项检查默认请求不含输出限额或思考控制、显式限额、达到限额不重试、Anthropic
必填参数及供应商切换时清除旧限额。
静态检查通过不等于 GeoGebra 执行成功。

引擎验收检查定义对象存在、显示值有效、点坐标有限，以及数学关系与实际属性状态。
属性命令返回 false 或构造返回标签，均不能单独证明成功或失败；没有运行引擎时不能
声称执行验证通过。验收方法留在验证文档，不加入每次生成 prompt。

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

已确认的 API 混用或非法调用从下发指令中剔除，校验结果上报且不触发生成重试。
最终接口的 validation 返回最终文本的 unknown_commands 和 command_errors。
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
