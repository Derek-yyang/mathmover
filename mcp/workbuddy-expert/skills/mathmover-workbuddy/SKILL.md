---
name: mathmover-workbuddy
description: |
  Operate the MathMover MCP inside WorkBuddy. Use when a user uploads a math problem image or asks to create, modify, inspect, or visually explain an interactive GeoGebra model.
---

# MathMover WorkBuddy 协作协议

本 Skill 规定 WorkBuddy Agent 如何调用 MathMover MCP。数学知识来自 MCP 的 `get_expert_prompt`、`get_sop_cards` 和 `ggb_commands.json`；本 Skill 只负责工具顺序、工作稿生命周期和验收方式。

## MCP 未连接

开始建模前先检查 `mathmover_open_canvas` 是否存在。如果 MathMover 工具不可用：

1. 不要反复调用 `workbuddy request mcp connection`，也不要重试旧会话。
2. 使用你当前可用的终端/命令执行工具，运行与本 `SKILL.md` 位于同一目录的 `bootstrap.ps1`：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "<本 Skill 目录的绝对路径>\bootstrap.ps1"
   ```

3. 如果终端工具首次执行需要用户授权，只请用户批准这次授权，不要要求用户自己输入安装命令。
4. 脚本会查找 WorkBuddy 自带 Node、下载并校验 MathMover MCP、写入 WorkBuddy 配置。成功时输出 `MATHMOVER_BOOTSTRAP=success`。
5. 成功后告诉用户：MathMover 已自动安装，需要完全退出并重新打开 WorkBuddy 一次。本轮不要声称图形已经创建。
6. 只有终端工具本身不可用时，才把脚本命令交给用户手动执行。

## 可用工具

- `mathmover_open_canvas`：创建或恢复画板，返回 `session_id`、工作稿路径和画板链接。
- `mathmover_list_canvases`：用户明确要求查找或恢复旧课件时使用。
- `get_expert_prompt`：题图任务按类别一次取齐建模流程和固定 SOP。
- `get_sop_cards`：只获取当前类别固定包之外、确实需要的补充写法卡。
- `ggb_apply`：执行当前会话工作稿中的完整构造。
- `ggb_get_state`：读取对象、滑块、审计结果、截图和降级信息。
- `ggb_reset`：仅在用户明确要求清空画板时使用。

## 类别

- A：函数与图像
- B：平面几何
- C：解析几何
- D：立体几何

由 Agent 根据题图判断，不额外向用户询问分类。

## 题图任务

1. 调用 `mathmover_open_canvas`，记录返回的 `session_id` 和工作稿绝对路径。
2. 判断题目类别 A/B/C/D。
3. 调用一次 `get_expert_prompt`，参数为对应 `category`。
4. 通读题图和返回的步骤化建模流程，清点输入对象、待求对象、动态变量和视图。
5. 用原生文件读取工作稿，再用原生编辑能力写入完整 `construction.ggb.txt`。
6. 调用 `ggb_apply`，必须传入当前 `session_id`。
7. 调用 `ggb_get_state`，检查对象是否存在、点坐标是否有限、依赖关系、视窗、警告和截图。
8. 若有错误，回到工作稿集中修正，再执行一次 `ggb_apply` 和 `ggb_get_state`。
9. 确认结果后返回简明说明，指出可操作对象和应当观察的变化。

题图任务不重复调用 `get_sop_cards` 获取 `get_expert_prompt` 已包含的卡片。

## 文字构建任务

用户没有题图，只要求“画一个圆”“创建椭圆和动点”等内容时：

1. 调用 `mathmover_open_canvas`。
2. 使用 MCP 系统简报中的通用 GGB 写法直接编辑工作稿。
3. 只有在现有写法不足以完成时，才按名称调用 `get_sop_cards`。
4. 继续执行 `ggb_apply` 和 `ggb_get_state`。

普通文字构建不调用 `get_expert_prompt`，避免加载整套题图建模流程。

## 连续修改

- 同一对话已有当前 `session_id` 时直接复用。
- 用户要求调整、增加对象或改变运动方式时，先读取工作稿当前内容，再在原内容上修改。
- 用户已经在画板中移动过对象时，先调用 `ggb_get_state`，不要把当前状态误当成交付时的初始状态。
- 不为了“刷新”而清空画板。清空会丢失用户当前操作，只有明确要求时调用 `ggb_reset`。
- 恢复旧课件时使用用户指定的 `session_id`；若用户只给课件名称，先用 `mathmover_list_canvases` 查找。

## 工作稿规则

- `construction.ggb.txt` 是完整、可直接执行的 GeoGebra 指令清单。
- 使用 WorkBuddy 原生 Read/Edit/Write 能力修改它，不要向 `ggb_apply` 传命令数组。
- 保留已有依赖和有效对象，按依赖顺序插入新对象。
- 不使用聊天输出中的临时命令替代工作稿。
- 工作稿采用 UTF-8 文本；命令、对象名和样例数值必须按当前题目替换。

## 错误恢复

- `GGB_SESSION_DEAD` 或未连接：用相同 `session_id` 再调用 `mathmover_open_canvas`，不要创建新会话。
- `mathmover_open_canvas` 已返回 URL 但宿主没有显示面板：向用户提供该链接，并继续说明任务状态。
- `ggb_apply` 返回对象缺失、坐标非有限或依赖异常：读取完整结果，修正工作稿后重试。
- 不要在没有真实执行和状态检查的情况下声称构造成功。
- 不进行无限自动重试。两次针对性修正仍失败时，明确列出剩余问题并要求用户补充必要条件。

## 输出规范

- 最终回答先给出完成结果，再说明可操作对象和应观察的数学关系。
- 不对用户重复完整 GeoGebra 指令，除非用户明确索要。
- 使用 Markdown 数学式描述关键关系。
- 用户的图形已经显示在 WorkBuddy 画板中，不在最终回答重复展示同一 URL。
