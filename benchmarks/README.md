# 基线金标准集（baseline-v1 收录中）

用线上环境逐题生成 GGB 指令，人工把关动图达标后收录，作为管线质量的判分基线。

## 目录约定

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

## 工具（scripts/benchmark.py）

```bash
.venv/Scripts/python.exe scripts/benchmark.py parse      # 解析金标准 -> expected_objects.json
.venv/Scripts/python.exe scripts/benchmark.py selftest   # 自对照判分，应 26/26 PASS
.venv/Scripts/python.exe scripts/benchmark.py score --case benchmarks/cases/初中/A-二次函数1 --candidate 某候选.txt
```

- 解析时自动剔除 `MODE:` 行、`#` 注释、空行；同名重复定义以最后一次为准
- 判分在对象语义层（kind + 坐标/参数/引用序列，坐标带容差），不比对指令顺序
- 收录新题后需重跑 `parse` 刷新 expected_objects.json，再 `selftest` 确认工具链自洽

## 跑批复测流程（pre/post 对比）

```bash
# 0. 确定模型通道后启动后端（Gemini 需代理；GLM/DashScope 直连）
.venv/Scripts/python.exe app.py

# 1. 跑批（自动等通道就绪、地域抖动自动重试）
.venv/Scripts/python.exe scripts/bench_run.py --label pre_p0 --fresh   # 或 post_p0

# 2. 换通道/换轮次前归档当前候选，避免被覆盖
#    candidate_commands.txt -> candidate_pre_p0.txt（或 candidate_glm.txt 等）
```

- 模型通道写在根 .env 的 `SYSTEM_*` 四行（OpenAI 兼容端点均可用，含 GLM 模板）
- 测试账号凭证在 `.secrets/bench_account.json`（跑分会自动登录扣积分）
- 报告输出在 `benchmarks/reports/<标签>_<时间>.json`

## 注意

- 题目图片为真题，仅随**私有**仓库保存；开源公开前需替换为自编题（见 PIPELINE_ROADMAP.md 第三节 P3）
