# 调参面清单：改哪儿能改变出图

跑批回归之前先看这份。它的用处是——**回归数字动了，能照着这张表判断该调哪儿**；
反过来，**动了表上的任何一处，都该重跑回归**。

## 判定标准

不争论"什么算变量"，用操作性定义：

> **改动它，回归就该重跑的东西 = 变量。**

按这个标准，变量不止四份 SKILL + SOP 卡库，还包括 agent 读到的说明书、
它看到的报错文案、以及决定什么被剔除的判据。这些全都是喂给模型的中文或规则，
跟 skill 没有本质区别。

分四层，按"离出图多近"排序。

## 先分清两条链路

产品是 **agent 驱动的 GeoGebra 画图工作台**；题图→GGB 是其中一条链路（需求最大），
不是产品本身。两条链路的入口不同，**要调的东西也不同**：

| | 入口 | 用到哪些变量 |
|---|---|---|
| **自由画图**（用户让你画/改图） | `get_drawing_pack` | `generation-rules` + `ggb-basics` + **全库 18 张卡** + 工具描述 |
| **做题**（用户发了题目图片/题面） | `get_expert_prompt` | 上面全部 + **4 份 SKILL 的 8 步建模方法论** + 本类清单 |

判据侧也随之分流：`submit_construction` 的 `category_structure`（A 要函数、B 要多边形/圆…）
**只在做题链路查**；自由画图不给 category，只做行级剔除与动点自洽。
所以调 SKILL 的 8 步**只会影响做题**，调 `ggb-basics` 或卡库**两条链路都受影响**。

---

## 一、智力侧：skill 资产

| 文件 | 控制什么 | 怎么调 | 谁守着 |
|---|---|---|---|
| `skills/function-expert/SKILL.md`<br>`skills/planar-geometry-expert/SKILL.md`<br>`skills/conic-expert/SKILL.md`<br>`skills/solid-geometry-expert/SKILL.md` | 8 步建模流程、什么情况跳哪支、每步的判断依据 | 改方法论措辞、增删分支、调步骤顺序 | **无**（金基线已退役） |
| `skills/shared/sops/*.md` ×18 | 具体 GGB 写法、示例、易错点 | 加变体、补易错点、拆/并卡 | `verify_sops` 只抓结构 |
| `skills/shared/ggb-basics.md` | 每题必用的 MODE / 视图 / 点 / 线 / 标签 / 样式 | 补通用写法 | **无** |
| `skills/shared/generation-rules.md` | 命名、常量精度、样式规范、「只取所需片段」 | 改输出约定 | **无** |

**分工规则（作者裁定，改之前要知会）**：每题必用的固定写法进 `ggb-basics`，
SOP 库只放「小范围、可能用而未必用」的条件写法。库里现在 18 张，四类分别引用 11/9/12/13。

---

## 二、说明书侧：agent 读到的文字

这一层最容易被漏掉——它们不在 `skills/` 下，但同样是 prompt。

| 文件 | 控制什么 | 怎么调 | 谁守着 |
|---|---|---|---|
| `math-mover-next/app/api/agent/route.ts` 的 `SYSTEM_BRIEF` | 「怎么干活」6 条、GeoGebra 指令要点、说人话的要求 | 改工作方式、加纪律 | **无** |
| `packages/daemon/src/mcp-server.ts` 各工具的 `title` / `description` | 模型据此决定调不调、何时调、传什么 | 加引导语、改措辞 | 工具面测试只抓 schema |
| 同文件 `CATEGORY_TAXONOMY` | A/B/C/D 分类判据原文 | 调类别边界描述 | **无** |
| `buildAllowedCommandsSuffix` 生成的文案 | 「仅可使用以上命令…不能把函数当圆锥曲线」 | 改命令约束措辞 | `sop.test.ts` 断言**区块标题在**（`### 严格语法约束`、`构造命令:`、`3D 构造命令`、`属性命令:`、`视图命令:`）；正文措辞可改，删标题会红 |

> `SYSTEM_BRIEF` 里"不许伪造对话边界"这类条目看着像杂务，实际是宿主协议约束，
> 改坏了会截断回复——动它先跑 `e2e-chat-panel.mjs`。

---

## 三、反馈侧：agent 看到的错

`packages/ggb-core/src/semantic.ts` 的 `detail` **不是报错文案，是给 agent 的指令**：

```
"存在文字对象 [...] 题目文字不应生成 Text 对象，请删除这些行"
"滑块 [...] 未驱动任何对象。若题目有动点，动点坐标应引用滑块"
"立体几何类题目：应为 3D 视图且含空间点…请按立体几何骨架重做"
```

| 文件 | 控制什么 | 怎么调 | 谁守着 |
|---|---|---|---|
| `semantic.ts` 的 `detail` 文案 | agent 拿到提示后怎么改 | 让提示更可执行、更少歧义 | `semantic.test.ts` 只要求**点出问题对象名**（含 `t`/`Slider`/`msg` 等），措辞可自由改，但不能把对象名从文案里去掉 |
| `submit_construction` 的回传组织 | 明细怎么排序、合并、是否附图 | 调信息密度 | **无** |

改这一层出图质量会变，**别当成"日志"顺手改**。

---

## 四、判据侧：什么被剔除、什么算过

| 文件 | 控制什么 | 怎么调 | 谁守着 |
|---|---|---|---|
| `ggb_commands.json`（仓库根） | 命令白名单与签名；非法行**剔除不下发** | 加命令、修重载签名 | `test_command_catalog` + `verify_sops` |
| `semantic.ts` 的判定规则 | free_param / orphan_slider / category_structure 怎么判 | 调判据松紧 | `semantic.test.ts` |

`ggb_commands.json` 是**双端共享的单一事实来源**（TS `whitelist.ts` 与 Python
`ggb_parser.py` 同吃）。改它两边都会变，且 `verify_sops` 会拿它校验全部 55 个示例。

---

## 灰色地带（边界待定）

以下三条我倾向算变量，但可以争论，**跑批前建议先定下来**：

1. **MCP 工具面设计** —— 工具数量、schema、参数必填与否。
   例：`get_expert_prompt` 的 `category` 从可选改必填，agent 行为就变了
2. **A/B/C/D 四类划分本身** —— 边界题归哪类，直接决定取哪套 skill
3. **`agent-runtime` 的图片与转写处理** —— 图片没喂进去质量必崩，
   但更像基础设施故障而非参数

## 仓库外的变量

**agent CLI 自身的模型与系统提示**（claude-code / codex / dsh 各自的）。
绝对影响出图，但不在这仓库里。回归要覆盖它，得把 **CLI 与模型版本**也锁进 fixtures，
否则换台机器跑出来的数字不可比。

---

## 调参前必读

- **金基线已退役，改 skill/SOP 没有任何自动回归。** `verify_sops` 只抓结构
  （孤儿卡、嵌套引用、示例 id 与夹具一一对应、白名单、生产解析器），**不抓画得对不对**
- **动卡片要动夹具**：每块 ` ```ggb ` 前必须有 `<!-- example: id -->`，id 要与
  `scripts/sop_examples.json` 一一对应，否则 `verify_sops` 直接红
- **删卡要同步删槽位**：SKILL.md 里的 `{{SOP:card-name}}` 必须独占一行、无重复、
  位于编号步骤内；漏改会报「SOP 插入位置缺失或格式错误」
- **示例是实例不是常量**：数字、名字、范围按题意替换。别为套示例而添条件、缩范围
- 改完跑一遍：`python -B scripts/verify_sops.py` 与 `python -B scripts/test_command_catalog.py`

## 与 P3 的关系

P3 回归基准集就是给上面这些变量装仪表。建它之前先记住**旧判分为什么被删**：

- L1 金标准比对：构造偏见不可修复，已退役
- L2 性质判分：性质清单带 `point_at` 类构造习惯残留，13 例 L2=FAIL 而 L3=pass/partial
- L3 视觉判官：21 例里冤枉 2、放水 2

**共同病因是把"应该怎么构造"写进了判据。** 新判据要写成与构造方式无关的数学性质
（"抛物线过这两点、动点可拖且在轨迹上"），判官模型自身要有校准依据。
