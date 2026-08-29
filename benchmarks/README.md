# 基线与度量体系

## 三层度量口径（2026-08-29 定型）

| 层 | 名称 | 职责 | 工具 |
|---|---|---|---|
| ~~L1~~ | ~~金标准比对~~ | **已退役**：构造偏见不可修复（以一份具体答案为标准，冤枉异构解法），其回归职能由 L2 更稳地承担 | benchmark.py（代码保留，不再作为主指标） |
| L2 | 性质判分（主标尺） | 开发内环：解析候选为对象图，验证题目数学性质（与构造方式/命名/顺序无关），全量跑批、精确归因 | scripts/properties.py + bench_run.py |
| L3 | 视觉判官（产品仲裁） | 无头渲染动图 + 滑块多帧交互 + 视觉模型对照题目图判分；L2/L3 不一致案例是校准 L2 的工单 | scripts/l3_run.py |

- 金标准 `golden_commands.txt` **永久保留**，角色转型：L2 性质清单的抽取原料、
  人工校准的参考解法、范例带教（expert_prompts.py）的种子库
- L3 渲染要点：3D 题必须先 `setPerspective('T')` 并等待视图就绪再执行指令；
  滑块用 `setValue` 取首/中/末三帧（等同拖动），解决"单帧遮挡"与"交互正确性"验证
- L3 判题模型取自本地 config.json（与产品同通道）

## 收录与跑批约定

每个案例文件夹 = 一道题：

- `problem.png` —— 题目原图
- `golden_commands.txt` —— 【待收录】在线上跑出、经人工确认达标的 GGB 指令，直接复制粘贴保存到此文件（文件名固定，便于后续自动化解析成对象清单）
- 文件夹名前缀 A/B/C/D = 路由器期望分类（A 函数与图像 / B 平面几何 / C 解析几何 / D 立体几何）

## 达标检查单（收录前逐条过）

1. 语法层：每条指令有效执行，无静默失败
2. 数学层：关键对象齐全、坐标/解析式与原题一致
3. 交互层：动点能动、滑块在、该锁定的点已锁定
4. 卫生层：无文字说明对象、无泄漏的辅助对象、画面干净

四条全过才收录；未达标的题不收录，留作后续改进的对照样本。

## 工具

```bash
# L2 性质判分（主标尺）
.venv/Scripts/python.exe scripts/properties.py convert     # 金标准 -> expected_properties.json
.venv/Scripts/python.exe scripts/properties.py selftest    # 金标准自对照，应 26/26 PASS
.venv/Scripts/python.exe scripts/properties.py matrix      # 多组候选性质矩阵

# 跑批（生成 + L2 判分一体化）
.venv/Scripts/python.exe scripts/bench_run.py --label <标签> --fresh

# L3 视觉判官（对 candidate_commands.txt 渲染判题）
.venv/Scripts/python.exe scripts/l3_run.py                 # 全量
.venv/Scripts/python.exe scripts/l3_run.py --case "初中/A-二次函数3" --show   # 单题+保留截图

# 解析器回归（金标准 -> 对象清单，性质清单的上游）
.venv/Scripts/python.exe scripts/benchmark.py parse && .venv/Scripts/python.exe scripts/benchmark.py selftest
```

- 解析时自动剔除 `MODE:` 行、`#` 与 `//` 注释、markdown 围栏；同名重复定义以最后一次为准
- 收录新题后需重跑 `parse` + `properties.py convert` 刷新两份清单

## 跑批复测流程（pre/post 对比）

```bash
# 0. 启动后端（模型通道在本地 config.json，或工作台侧栏「模型设置」修改）
.venv/Scripts/python.exe app.py

# 1. 跑批（主指标为性质口径）
.venv/Scripts/python.exe scripts/bench_run.py --label <标签> --fresh

# 2. 换通道/换轮次前归档当前候选，避免被覆盖
#    candidate_commands.txt -> candidate_<标签>.txt
```

- 测试账号凭证在 `.secrets/bench_account.json`（鉴权用；后端已无积分扣费）
- 报告输出在 `benchmarks/reports/<标签>_<时间>.json`

## 注意

- 题目图片为真题，仅随**私有**仓库保存；开源公开前需替换为自编题（见 PIPELINE_ROADMAP.md 第三节 P3）
