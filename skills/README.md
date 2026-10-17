# MathMover 标准画法库

本目录供应用的专家模型生成 GeoGebra 指令使用。四份 `SKILL.md` 完整指导模型如何把
本类题的条件、参数与关系按标准作图步骤转化为构造；`shared/sops/*.md` 提供具体写法参考，
通过正文中的 `{{SOP:card-name}}` 嵌入对应步骤。
`shared/generation-rules.md` 统一精简输出约定；命令的使用条件与易错写法保留在对应 SOP。
skill 的编号流程始终完整加载，模型仍直接读取原题文字/图片；按题跳过无关分支，
输入对象及其依赖可提前建立。SOP 是当前步骤的写法参考，按题取用片段。

## Prompt 装配

题目类别由调用方给出（agent 自己判；分类路由与一次性生成管线均已下线）。
卡片集合和插入位置只由 skill 决定，不由调用方临时指定。

`ggb-core/src/sop.ts` 提供两套装配，共用同一批源文件：

```text
画图基础包 assembleDrawingPack：公共约定 + 通用 GGB 写法
  → get_drawing_pack 是画图基础包，附全库写法卡清单（不按类别裁剪）

专家包 assembleSkill：公共约定 + 通用 GGB 写法 + 专家步骤（{{SOP:*}} 只留指路行）
  → get_expert_prompt 是题目增强（**只在带了题图时取**；纯文字题面不算），附本类清单（带流程步骤号）
```

产品定位是 agent 驱动的 GeoGebra 画图工作台，题图→GGB 只是其中一条链路——
**4 份 SKILL 的建模方法论只服务那条链路**，平时画图用不到。两者的具体写法
都由 `get_sop_cards` 按名批量抽取。

原先还有卡片原位内联的 `assembleExpertPrompt`（+ 命令白名单），配 Python
`expert_prompts.py` 作参考实现、用 `prompt-goldens.json` 做逐字节对拍；
这三样连同金基线已随一次性生成管线下线退役。

- skill 在相应编号步骤写独占一行的 `{{SOP:card-name}}`。装配时该行变成指路行
  （`〔写法卡：a、b —— 动手前用 get_sop_cards 取用〕`），保持「哪一步用哪张卡」的映射，
  不把正文搬进 skill。模型按题跳过无关分支、按需取卡。
- 四份 skill 都明确引用隐藏辅助写法；没有另设常驻卡列表。视图、点、线、标签、样式等
  每题必用的通用写法已收入 `shared/ggb-basics.md`（与 `shared/generation-rules.md` 同为
  skill 前置层），不再占卡。
- 跨类别能力通过在该 skill 的合适步骤直接引用同一张卡片复用，不复制卡片正文，
  不临时添加卡片。所需支撑写法同样在 skill 中直接引用并按对象依赖安排位置。
- 引用缺失、重复、格式错误、位于编号步骤外或卡片含嵌套引用时明确报错。
- 同一类别装配相同的专家正文；类别只决定取哪份 skill，不影响卡片集合。
- 语法/语义校验只做清洗与遥测，不回灌重试（2026-10-08 移除：整代重试耗时且
  掩盖 prompt 短板，质量改进回到 prompt/SOP 源头）。

数学正确性须用实际题目验证，不能凭 prompt 长度或语法通过推断。

## 覆盖范围

| 构造 | 卡片 |
|---|---|
| 关系点、平行垂直、变换与样式 | geometric-relations |
| 求交、垂足 | intersection、projection-foot |
| 函数与圆锥曲线 | function-object、curve-definition、conic-features |
| 圆、弧、切线与切点 | circle-tangent |
| 一维/二维运动、派生点轨迹 | moving-point-function、moving-point-path、moving-point-region、locus |
| 多边形及区域 | closed-region |
| 按视图隐藏计算对象 | hidden-helper |
| 三维建系、线框、平面、有限截面、旋转体 | 3d-frame、3d-edges、plane-helper、polyhedron-section、rotation-solid |

库有 18 张卡（每题必用的通用写法在 `shared/ggb-basics.md`，不占卡）。
四类 skill 分别引用 11 / 9 / 12 / 13 张；新增卡片只需创建卡片文件，
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

Python 侧只剩 SOP 静态校验与命令目录校验（纯标准库，不调模型、不读凭据）。
prompt 装配在 TS 侧（`ggb-core/src/sop.ts`），由其单测覆盖。

在仓库根目录运行：

```powershell
python -B scripts/verify_sops.py
python -B scripts/test_command_catalog.py
```

第一项检查引用覆盖、示例与白名单：无孤儿卡、无嵌套引用、每块 ggb 都有示例 id、
id 与 `sop_examples.json` 一一对应、命令在白名单内、生产解析器可解析；
第二项检查命令目录。上述命令不调用模型、不读取凭据。
静态检查通过不等于 GeoGebra 执行成功。

引擎验收检查定义对象存在、显示值有效、点坐标有限，以及数学关系与实际属性状态。
属性命令返回 false 或构造返回标签，均不能单独证明成功或失败；没有运行引擎时不能
声称执行验证通过。验收方法留在验证文档，不加入每次生成 prompt。

生成独立浏览器验证页面，服务只暴露临时 QA 目录：

```powershell
python -B scripts/verify_sops.py --html-dir "$env:TEMP\mathmover-sop-qa"
python -B -m http.server 8766 --bind 127.0.0.1 --directory "$env:TEMP\mathmover-sop-qa"
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
