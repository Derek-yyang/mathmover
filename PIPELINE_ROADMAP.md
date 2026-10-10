# 项目演进路线图（MathMover）

> 本文档记录 MathMover 的整体演进方向：核心生成管线（AI 生成 GGB 指令、
> GGB 引擎绘图）的迭代、开源规划、以及学科扩展方向。
> 建议在每个开发阶段开始时回顾本文档，完成后勾选对应条目并补充实测数据。
> 创建于 2026-08-27。

## 一、生成管线方案定位结论

「AI 生成 DSL、确定性引擎执行」的架构方向是正确的：把 LLM 当**编译器前端**，
负责"题意 → 形式化指令"的翻译；所有数学计算交给 GeoGebra 引擎执行。
相比直接生成图片（不可交互）、生成 JS 代码（幻觉空间大）、端到端文生图（不精确），
这是当前最正确的路线，**方案不需要更换**。

四个专家 prompt 中沉淀的实战规则（slider 格式约束、交点处理、原子化连棱等）
是经过真实踩坑迭代的领域 know-how，本身构成壁垒。

## 二、当前的结构性短板

1. **开环生成，没有校验回路** —— specialist 输出的指令不做合法性检查直接下发前端执行，
   无效指令静默失败或画出错误图形，用户只能重新生成碰运气。
2. **靠堆否定句补丁而非系统性兜底** —— 专家 prompt 里全是"禁止/不要/务必"，
   每发现新翻车模式就追加一条，prompt 越来越长且永远追不完。
   （prompt 中还残留字符串拼接痕迹：字面引号与 `\n` 文本，见原 `app.py` 各 PROMPT_*
   定义——该文件已随一次性生成管线下线，现行 prompt 在 `skills/*/SKILL.md`。）
3. **让模型手算数学，放弃了引擎的最大价值** —— 解析几何强制手算焦点为十进制近似值、
   函数题禁止 Intersect 要求硬编码交点坐标，本质是逼迫 LLM 做符号运算与浮点近似，
   风险从"可见可修"变成了"隐性算错没人知道"。

## 三、演进路径（按性价比排序）

### - [x] P0：指令校验层（验证闭环）

specialist 输出后、下发前端前，逐条对照白名单校验对象/属性命令的签名；
不合格行过滤掉；若合格率低于阈值，把报错信息拼回上下文自动重试一次。

- 改动位置：原 `app.py` /api/upload 的 generate() 内（该管线已下线）。**校验层本体还在**，
  现落于 `ggb-core` 的 `checkLines` / `classifyLine`，由 `submit_construction` 做行级剔除
- 收益：通常能把可用率拉高一大截；此后可以从容删减 prompt 里的否定句补丁
- 验收标准：无效指令不再到达前端；重试逻辑有日志可观测
- 完成情况：2026-08-28 实现（`app.py` + `ggb_parser.py` 共享解析器）。
  26 题基线实测（qwen3.5-plus，改造前→后）：语法有效率 98.1%→**100%**，
  含无效指令行的题 5→0，1 例经重试从 15/27 提升到满分 PASS。
  判分工具（**已不在仓库**）：`scripts/benchmark.py`（解析+判分）、`scripts/bench_run.py`（批量跑批），
  金标准 26 题在 `benchmarks/cases/`。遗留：语义层命中率仅 55%→62%，
  构造方式差异是主要质量瓶颈，属 P1+ 范畴；跨模型泛化方面
  prompt 对 Gemini 调优痕迹明显（Gemini 命中率 75% vs qwen 55%），需模型无关化改写。

> 2026-10-08 政策更新：P0 校验层与语义自查的**回灌重试已整体移除**——每次重试都是
> 一轮完整再生成（数十秒），且触发重试本身说明 prompt/SOP 没打磨到位，靠重试兜
> 质量既慢又不一定提高。校验降级为「清洗 + 遥测」：无效行仍剔除，validity /
> command_errors / unknown_commands / semantic_failures 随 completed 事件上报；
> 质量改进回到 prompt 与 SOP 源头迭代，引擎侧兜底保持前端 evalCommand 布尔返回值告警。

### - [ ] P1：把计算还给 GeoGebra

交点用 `Intersect(l, c, n)` 加索引消歧来做（引擎本就有此能力），
焦点/焦距等由引擎计算，模型只负责定义结构关系。
手算仅保留在题目明确要求标注数值的场景。

**写法层已大半就位**：`function-object` 用 `Extremum` / `Root` / `Tangent`、
`conic-features` 用 `Focus` / `Directrix`，都是引擎算。**剩下没做的是流程正文**——
skill 仍让模型「求出可确定参数/系数」并自己核对坐标，这正是算错的源头
（历史 7 例质量问题里的「A1 坐标算错」）。

- 改动位置：`skills/*/SKILL.md` 的「初始化并确定数据」「建立基准点」步骤正文
  （原 `app.py` 的 PROMPT_FUNCTION / PROMPT_ANALYTIC 已随一次性生成管线下线）；
  求交索引消歧的写法在 `skills/shared/sops/intersection.md`
- 收益：消除隐性算错；prompt 变短
- 验收标准：抽样对比改造前后同类题目的正确率

### - [x] P1.5：校验白名单升级（建议与 prompt 模型无关化改写同期做）

现状：`ggb_parser.py` 的指令白名单（约 30 个构造器 + 11 个属性命令 + 5 个全局命令）
是从 26 道金标准题**归纳**出来的"样本影子"，不是 GeoGebra 官方命令集的权威节选。
目前靠"prompt 明文约束模型只用这些命令"的纪律闭环，换模型 / 改 prompt 后会变脆。

两个软肋：

1. **漏（更致命）**：白名单外的合法命令会被当"无效行"——轻则触发冤枉重试，
   重则该行被静默剔除导致图形缺一块且无人察觉。"把未知当无效"是归纳式白名单的固有缺陷
2. **漂移**：各专家 prompt 里声明的"允许命令集"与代码白名单是两处手写，靠人肉保持一致

升级路径（按性价比）：

1. 对齐 GeoGebra 官方命令表一次性扩充：prompt 允许集 + 常用几何命令（Derivative、
   Root、PerpendicularLine 旧拼写等），从"样本影子"升级为"权威地图节选"
2. 策略从"宁错杀"改为"宁可放过"：形式像命令的未知行改为**放行下发 + 记日志**
   （GGB 自己静默失败一条的伤害 < 我们丢掉一条合法指令的伤害）；
   可用前端 `evalCommand` 返回值做兜底信号（目前 dashboard 未接）
3. 单一事实来源：prompt 允许集与代码白名单从同一份配置生成，改一处两边同步
4. 遥测驱动生长：跑批/线上统计"未知但高频"的命令，人工确认后纳入（与 P4 联动），
   白名单从静态清单变成随真实流量生长的活文档

- 验收标准：跑批中"未知命令导致的剔除"为 0；白名单与 prompt 允许集同源可同步
- 完成情况：2026-08-28 全部落地。
  (1) `ggb_commands.json` 权威命令表（~90 构造器按 2D/3D 分组 + 属性 + 全局命令）；
  (2) 解析器策略反转：未知命令放行下发 + 标记遥测，仅纯文字行剔除，重试触发条件同步收紧；
  (3) prompt 的"严格语法约束"区块改为运行时从命令表生成注入
      （原 `app.py: build_allowed_commands_suffix`，现为 `ggb-core/src/sop.ts`
      的 `buildAllowedCommandsSuffix`），手写区块已删，单一事实来源达成；
  (4) bench_run 跑批报告新增 unknown_commands 统计；前端接通 evalCommand 布尔返回值，
      失败≥3 条 toast 告警（引擎兜底信号）。
  26/26 解析与性质自测全绿，端到端验证通过。

### 判分标准升级：三层度量体系定型（2026-08-29）

| 层 | 职责 | 状态 |
|---|---|---|
| ~~L1 金标准比对~~ | ~~同模型回归~~ | **退役**：构造偏见不可修复；金标准原文永久保留（L2 抽取原料 + 校准参考 + 范例种子） |
| ~~L2 性质判分~~ | ~~开发内环主标尺：全量跑批、精确归因~~ | **工具已不在仓库**（`scripts/properties.py`、`bench_run.py` 随一次性生成管线退役） |
| ~~L3 视觉判官~~ | ~~产品仲裁：无头渲染 + 滑块多帧交互 + VLM 对照题目图判分~~ | **工具已不在仓库**（`scripts/l3_run.py` 同上） |

> 2026-10-10 记录：**L2/L3 的跑批工具已删除**，`scripts/` 下现在没有 benchmark /
> bench_run / properties / l3_run。**这是主动删除，不是随管线丢失**——旧判分本身
> 不可信（见下：性质清单带构造习惯残留、判官有冤枉与放水、L1 因构造偏见退役），
> 原样重建只会把同样的毛病带回来。下面的数字是当时的实测结果，保留作度量口径的
> 参考；后续要建的是一套**更可信的判分**，不是复原旧工具。

L3 实现要点：滑块 `setValue` 首中末三帧（等同拖动，解决单帧遮挡与联动验证）；
3D 题先 `setPerspective('T')` 等视图就绪再执行指令；判题模型与产品同通道（原 `config.json`，已删）。

首轮 L3 全量（24 题候选）：**17 PASS + 4 partial（83% 达到或接近可用）**，3 fail。
L2/L3 不一致 15 例：13 例为 L2=FAIL vs L3=pass/partial——确认性质清单仍含
Gemini 构造习惯残留（point_at 类过严），这批案例即性质清单人工校准的工单；
真实 fail 仅 3 例（B-四边形1 渲染空白、D-多面体1 缺对象、D-球2 数学位置错误），
是产品当下真正的修复目标。产品真实可用率（L3 口径 83%）显著高于 L2 严格口径，
印证"以动图的数学实质为准"的度量哲学。

#### 2026-08-30 判官人工盲评校准（作者仲裁 21 例）

背景：渲染链路四连修（定义先行重排/会话令牌/视图就绪等待/setPerspective 方法化）
后重跑 L3，作者在产品端逐题盲评（题目原图对照真实动图）。

结论：
- **渲染链路失败 0 例**（修复前 15/25 渲染失败）——产品端渲染缺陷清零
- **判官 qwen3.8-flash 准确率 81%（17/21）**；作者决策**不换判官模型**
  （其跑分高于候选强模型），偏差用判官 prompt 校准：
  - 冤枉 2 例：完好图判 fail（#08）；仅镜像但以"退化"过严判 fail（#20）
  - 放水 2 例：动点被固定判 pass（#02）；动点约束错误判 pass（#15）
  - 校准方向：动点必须真实可拖才可 pass（联动数值断言给否决权）；
    点脱离题设轨迹 = fail；构造正确仅方向/镜像与配图不符 ≤ partial
- 本轮 7 例生成质量问题（prompt 迭代弹药库）：PerpendicularLine 参数顺序写反
  （点/线换位连锁 5 对象失败——可做校验层自动纠正）、动点未绑定路径（死点）、
  P 未约束于正方体内部、圆锥缺失、A1 坐标算错、镜像方向、缺关键对象

### - [x] P2：分类路由下线（2026-10-10）

原「瘦身或降级」的两个方案都不需要了——分类不再由独立模型做：

- agent 链路：agent 自己看题判 A/B/C/D，调 `get_expert_prompt` 时把类别一并给出
  （`ggb_route` 这个独立登记步骤已删，工具面 8 → 7）
- 老管线 `/api/upload`：先改为类别由请求字段传入，随后随整条管线一并退役（见下节）

已删：`route_classify` / `llm_classify` / `parse_router_result` / `ROUTER_PROMPT`、
`decision_router.py`（Perplexity 决策模型与缩图探针）、配置里的 `router_mode` /
`perplexity_api_key` / `decisions_threshold` / `decisions_model`、
设置页「分类路由」面板与 `routing-settings.ts`。

效果：单次生成从两跳大模型降为一跳，Perplexity 依赖与置信度回退逻辑一并消失。

### - [x] 一次性生成管线下线（2026-10-10）

题目→构造已全部交给第三方 agent CLI（Claude Code / Codex / dsh）经 MCP 工具面完成。
Python 一次性生成管线（Router → Specialist → 校验）没有任何调用方——前端只打
`/api/agent` 与 `/api/coursewares`，两个都直连 daemon——整条退役：

- 删 `app.py`（Flask + 三个模型适配器 + ModelFactory + config 层 +
  `/api/upload`、`/api/config`、`/api/config/models`）
- 删 `semantic_guard.py`（TS `ggb-core/src/semantic.ts` 已是同款判据）
- 删 `scripts/test_prompt_pipeline.py`、`test_model_output_limits.py`、`switch_provider.py`
- 删根 `Dockerfile` / `.dockerignore` / `requirements.txt`；`docker-compose.yml` 摘掉 backend 服务
- `math-mover-next/next.config.ts` 去掉 `/api/:path*` → 后端的 fallback 重写与 `BACKEND_INTERNAL_URL`

**Python 侧保留**：`ggb_parser.py` / `ggb_catalog.py` 与
`scripts/verify_sops.py`、`test_command_catalog.py`——SOP 静态校验 + 命令目录校验。纯标准库。

**2026-10-10 追加**：Python 侧的 prompt 装配参考实现也一并退役。`expert_prompts.py`、
`scripts/gen_prompt_goldens.py`、`scripts/test_sop_loader.py`、
`packages/ggb-core/src/data/prompt-goldens.json`、`scripts/diag-golden-diff.mjs` 删除。
金基线的立身之本是「Python ↔ TS 逐字节对拍」，参考实现一走就没了对拍对象；
剩下那层「改动探测」对单人维护的卡库只是仪式。装配逻辑由 `sop.test.ts` 的行为测试覆盖。
`verify_sops.py` 只依赖卡库路径与 skill 槽位解析，已把这几样内联进去，不受影响。

`config.json` / `providers.json` / `scripts/probe_channel.py` 也一并删除（2026-10-10）：
它们只服务于被删管线，留着只是盘上的明文密钥。

### - [ ] P3：回归基准集

攒 50~200 道代表题 + 各自期望的关键对象清单，形成自动化回归套件。
**动手前先读 `docs/tuning-surfaces.md`**——调参面清单，列清了改哪儿能改变出图
（不止 skill 与 SOP 卡，还有 agent 读到的说明书、反馈文案、判据），以及谁守着哪些。
现在要换的是 **agent CLI**（claude-code / codex / dsh，见
`packages/agent-runtime/src/defs.ts` 的 `RUNTIMES`）和它们背后的模型——
没有这个套件，任何一次换 CLI / 换模型都是在盲飞。

- 建议形态：fixtures（题目 + 期望对象）+ 批跑脚本。判据现成：
  `ggb-core/src/semantic.ts` 的 `semanticCheck` 按类别查结构，`ggb_get_state`
  给对象清单，`submit_construction` 回传行级/语义明细；链路怎么跑可参考
  `math-mover-next/scripts/smoke-agent-route.mjs` 与 `scripts/e2e-chat-panel.mjs`
- **注意：判分这块要新建，不是复原**——原 L1/L2/L3 的 `scripts/benchmark.py`、
  `bench_run.py`、`properties.py`、`l3_run.py` 已被主动删除（旧判分本身不可信，
  见下文三层度量体系）。重造时必须避开旧毛病：**别把某家模型的构造习惯写进断言**
  （`point_at` 类过严就是这么来的），断言要写成与构造方式无关的数学性质；
  判官模型自身也要有校准依据（旧判官 21 例里冤枉 2、放水 2）
- 验收标准：换 CLI / 换模型时一键跑分并输出各题 pass/fail 报告

### - [ ] P4：质量遥测

记录每次生成的：类别、指令有效率、重试次数、用户生成后的手动修改行为
（后者是最好的隐式质量信号）。

- 数据落点：本地 SQLite，与课件库同处——`packages/daemon/src/courseware-store.ts`
  现有 `coursewares` / `revisions` 两张表，加一张 telemetry 表即可
  （Supabase 已随 SaaS 化下线，不复存在）
- 现成信号：类别在会话账本里（`packages/daemon/src/mcp-server.ts`）；
  行级指令有效率与语义失败明细由 `submit_construction` 回传；
  用户的手动修改本来就落在 `revisions` 版本历史里，差分即是隐式质量信号
- 用途：驱动后续 prompt / SOP 调整有据可依，量化 P0~P1 的实际收益

## 四、一句话总结

方案不用换，壁垒在于把它从"能出图的生成器"升级成"带验证闭环的编译器"——
P0、P1 做完，与同类竞品会拉开肉眼可见的差距。

## 五、方向性规划：开源整个项目（想法阶段，未启动）

> 2026-08-27 记录：以下为作者确认的长期方向，**尚未进入开发排期**。
> 启动前本节内容可能调整；启动时建议把条目拆为独立 issue 逐项推进。

### 前置审计结论（2026-08-27 已完成的只读检查）

- 全部 11 个提交的历史 blob 扫描：`.env` / `.pem` / 密钥类文件从未入库，
  无 JWT 特征串，migrations 干净，Tauri 配置无签名私钥
- 结论：**不需要重写历史**，仓库可直接公开
- 待处理小项：历史作者署名含 QQ 邮箱（1607452059@qq.com），公开即暴露；
  可统一改用 gmail 署名，历史重写可选非必须

### A. 安全必修（公开前必须完成）

公开等于全网可见 + 可被打，以下两项从"建议"升级为"必做"：

- [x] ~~500 错误不再向客户端返回异常原文（`app.py:596-601`）~~ 随 Python 生成管线下线失效
- [x] ~~BYOK `custom_base_url` 增加 https 强制与私网地址拒绝（`app.py:558`）~~ 同上

### B. 工程门面（clone 下来就能跑）

- [ ] 重写 README：项目简介、架构图（agent CLI → MCP 工具面 → daemon → GeoGebra）、
  `.env` 变量、本地启动指南（起 daemon 与前端）。原「Supabase 建库 / migrations 导入」
  已不存在，README 该按本地优先的形态重写
- [x] ~~新增后端 `.env.example`~~ 随 Python 生成管线下线失效
- [ ] 新增前端 `.env.example`
- [ ] 添加 LICENSE 文件（协议见 C-1，它决定 README 里商业模式怎么写）
- [x] ~~`requirements.txt` 锁定版本~~ 该文件已删，Python 侧零第三方依赖
- [x] ~~supabase 迁移文件时间戳去重（三组前缀各被两个文件共用）~~ Supabase 已下线，无迁移文件
- [x] 移除脚本中的个人机器硬编码路径（start-local-test.bat 的 kimi-desktop node.exe）
  2026-10-08 收尾：改用 PATH 的 node 后，该 bat 与 `start_backend.ps1` 职责重叠且无运行痕迹，
  随死脚本清理一并删除；本地启动统一走 `scripts/start_backend.ps1`。
  2026-10-10 更新：`start_backend.ps1` 随 Python 生成管线下线一并删除，本地不再有后端进程。

### 商业模式定调（2026-08-27，想法阶段确认）

- **开源即全免费**：代码开源，无付费托管版
- **分发载体 = 桌面端**：用户下载 Electron 桌面应用，各自接入自己的 API key（BYOK）
- **mathmover 线上站点转为 demo**：供试用，接入若干免费档 API key，作为转化入口
- 连带影响：GeoGebra 非商用条款风险基本消除；原会员/订阅收入归零，
  demo 站成本需自担并设硬上限

> 2026-10-08 记录：**线上服务器已停服，部署链路整体退役。**
> 已删除 `.secrets/`（服务器 SSH 私钥 + 跑批测试账号）与 `scripts/deploy.sh`，
> docker-compose 的 Caddy 反代服务一并移除（mathmover.top 反代配置随之失效）。
> 上一条「线上站点转 demo」因此失去既有承载，**demo 要放哪需重新拍板**
> （新服务器 / 静态托管 / 只做桌面端不设 demo）；C-4「域名确认」的事实基础也已改变。

### C. 剩余待拍板事项

1. **开源协议**：倾向 Apache-2.0（传播友好 + 专利授权保护）或 MIT；
   AGPL 的自保价值随付费托管取消而消失。接受 fork 无约束，护城河 =
   prompt 资产 + 校验闭环 + 社区
2. **demo 站防滥用设计**：积分体系改造成"注册送每日配额"作为限流器；
   手机号验证拦批量注册；免费 key 仅存服务端；设硬性日调用上限，
   触顶降级为"下载桌面端体验完整版"
3. **桌面端 BYOK 架构**：key 不再过服务器 → 模型调用需本地直连。
   两条路线待选：prompt 管线移植为 TS 跑在桌面壳内（长期正解）vs
   Python 后端打包 sidecar（重但省移植）。此决策反向抬高 P0 校验层价值
   （校验在用户本地执行，节省用户自己的 token）

   > 2026-10-08 更新：**桌面壳由 Tauri 改为 Electron**（作者决策），
   > `src-tauri/` 的 424 行 Rust 已删除。Electron 主进程即 Node，
   > 「prompt 管线移植为 TS」这条路线的可行性显著高于 Tauri（Tauri 侧只能用
   > Rust 重写或走 sidecar），C-3 的天平因此偏向 TS 路线。
   > 连带影响：`next.config.ts` 的 `output: 'standalone'` 与 Electron 天然兼容
   > （壳内起 Node 服务加载它），此前与 Tauri `frontendDist: '../out'`
   > 期望静态导出的冲突自然消解。
   >
   > **可移植设计已从 Rust 侧抢救出来**（Electron 版可照此实现，不必重新设计）：
   > - SQLite 三表：
   >   - `users(id, email, created_at)` + BYOK 字段 `api_key` / `api_base_url` /
   >     `api_model_name`（**这三列就是"key 存本地"的设计意图**）
   >   - `generations(id, user_id, image_path, ggb_commands, problem_type, description, created_at)`
   >   - `images(id, user_id, filename, filepath, created_at)`
   > - 本地命令面：用户与设置读写、生成历史 CRUD、图片存取（save/load/delete/path）
   > - **已剔除的 SaaS 残留**：`credits`、`subscription_tier`、`decrement_credits`
   >   —— 与 web 侧会员/积分清理同源，产品已定调开源全免费
   >
   > 2026-10-10 更新：**上面两条路线的前提都没了。** 一次性生成管线下线后
   > Python 后端不复存在（sidecar 无从打包），"prompt 管线移植为 TS"也不成其为
   > 移植——生成现在由本机第三方 agent CLI 完成，仓库里只剩 SOP 静态校验还是 Python。
   > 三表设计里的 `generations.ggb_commands` 同理过时：指令清单由 agent 产出并经
   > `submit_construction` 下发，不再是管线的直接输出。
   > **C-3 要重新拍板**：桌面壳真正要解决的变成「怎么把 agent CLI 与 daemon 一起装进
   > Electron、并管好用户自己的 API key」，而不是管线往哪跑。
4. **域名确认**：线上现为 mathmover.top，demo 是否启用 .com 新域名待定
5. **品牌确认**：MathMover 名称与 com.mathmover.desktop 标识是否延续到开源仓库

### D. 社区化（锦上添花，后置）

- [ ] CONTRIBUTING.md、issue 模板、CI（lint + build）
- [ ] 在线 demo 链接
- [ ] 本路线图文档随仓库公开（透明展示技术演进方向，对项目形象加分）

### 依赖关系

C-1（协议）决定 B 中 README 与 LICENSE 的写法 → 建议先拍板协议；
A 两项工作量小但必须先于公开；B/D 均不阻塞协议决策。

## 六、方向性规划：初高中物理领域包（想法阶段，未启动）

> 2026-08-29 产品验收标准定调（作者决策，后续跑批均以此为验收）：
>
> 1. **泛化达标定义**：选定的一组主流模型（清单待作者提供）× 全部基准题 ×
>    **多轮生成，L2 与 L3 全过**——多轮全 100%，单轮高分不算数
> 2. **验证闭环留在链路外**：L2/L3 是优化链路的量具，不进生成链路
>    （避免增加生成耗时）；将来可在链路内加**不影响速度的轻量检查**
>    （P0 语法校验已是其一）
> 3. **题型范围 = 可作图题封闭集**：A 函数 / B 平面几何 / C 解析几何 / D 立体几何，
>    不扩展到非作图题型；题型泛化 = 4 类骨架的范例覆盖度
> 4. **模型策略**：不做逐模型 prompt 适配；标准是选定模型集上整体达标，
>    模型清单由作者提供后逐个跑基准矩阵验证

> 2026-08-27 记录：用户呼声驱动的第二学科方向，模式与数学一致
> （上传题目图片 → AI 生成演示图）。**先做好 MathMover，再启动本方向。**

### 复用与新增的边界

- **直接复用**：登录/积分/上传/流式生成/校验回路等管线骨架；
  P0 的 IR（中间表示）设想在此长成"结构化场景 schema"
- **需新建**：各子领域的渲染引擎与 prompt 体系（相当于新的领域包）

### 子领域选型预览（2026-08-27 初步考察）

物理没有 GeoGebra 式的一体化方案，按子领域各有答案：

| 子领域 | 现成方案 | 判断 |
|---|---|---|
| 电路图 | schemdraw (MIT)、circuitikz、CircuitJS1/Falstad | 有真答案：静态用 schemdraw 服务端渲染；交互仿真嵌 CircuitJS1 |
| 力学受力图/示意 | 无主流 DSL | 大概率自研 SVG 组件库；按人教版画法规范做即护城河 |
| 光路图 | 无现成 web 方案 | 自研"场景配置→确定性光线追迹引擎"，折射反射可复用数学几何引擎 |
| 运动/碰撞/单摆 | matter.js / planck.js / Rapier | AI 生成场景 JSON + 引擎实时仿真，交互性最强、体验差异最大 |
| 波/场/热学 | 无 | 需求出现再议 |

### 关键架构判断

物理场景天然是 JSON schema（倾角/质量/电阻等参数化配置），
比 GeoGebra 字符串指令更易校验（schema 校验非法即重试）。
P0 的 IR 设计应预留向物理场景 schema 演进的空间——两个产品共用
"结构化场景 → 确定性引擎执行"的哲学。

### 启动建议

正式考察放到 MathMover P0/P1 落地之后；优先子领域按用户呼声定
（预期：受力图与电路图靠前）；启动时先做单子领域 MVP 验证管线再横向铺开。

## 维护约定

- 完成一项就把 `- [ ]` 改为 `- [x]`，并在该条目下追加一行"完成情况：<日期> <实测效果>"
- 发现新的结构性短板时补充到第二节；新想法先挂到本文档再排期，避免散落在聊天记录里
- 第五节为方向性记录：进入实际开发时，把对应条目移入正式排期（第三节或独立 issue），
  并在节首更新状态说明，避免读者误以为已在执行
