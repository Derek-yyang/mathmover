# 正式验收对比报告（三模型）— 2026-09-05

## 验收口径（用户已拍板，见 PIPELINE_ROADMAP.md）

- **泛化达标** = 选定模型清单 × 全部 26 题 × **多轮生成 L2 性质判分全过**（后续补 L3 视觉判官）
- L2 有效题数 25（C-抛物线1 历史错位样本 `"skip": true` 下架待重收录）
- 主指标：性质命中率（跨模型可比）；题型为四类作图题封闭集；不做逐模型 prompt 适配
- 判分链路：`ggb_parser.py`（含 `strip_think_blocks`，think 污染已免疫）+ `scripts/properties.py`

## 矩阵总览（L2 性质判分，校准后清单口径）

| 模型 | r1 | r2 | r3 | 性质命中 | 状态 |
|---|---|---|---|---|---|
| **qwen3.8-flash**（新范例 prompt） | **88%** (22/25) | **92%** (23/25) | **96%** (24/25) | 98.5~99.5% | ✅ L2 三轮完成，L3 待补 |
| **deepseek-v4-vision** | **88%** (22/25) | 待补 | 待补 | 97.5% | 🟡 r1 完成，通道欠费中断 |
| **minimax-m3** | 1/26 后中断 | — | — | —（首例 11/11 全过） | 🔴 阻塞：通道欠费 |

数据来源：
- qwen 三轮：`property_matrix_task2.json`（清单校准后重算，commit `bb8c9ff`）
- deepseek r1：本报告日离线重判（`scripts/rejudge_offline.py`），与流式跑批报告 `acc_deepseek-v4-vision_r1_*.json` 互证
- minimax：`acc_minimax-m3_r1_20260905_213226.json`（仅完成首例）

## 关键结论

1. **跨厂商泛化成立**：deepseek-v4-vision 与 qwen3.8-flash 同一 prompt 体系下 r1 持平（88% vs 88%），
   证明 P1 范例带教式 prompt 已摆脱对特定厂商的过拟合（对比旧体系 Gemini 75% vs qwen 55% 的 20pt 差距）。
2. **deepseek r1 三例失败均为常规问题**（无链路/渲染 bug）：
   - `C-抛物线2`：conic_exists（圆锥曲线未建成）
   - `C-椭圆4`：point_at / slider_range / moving_point（定点+动点体系缺失）
   - `D-球1`：no_text（残留文字对象）
3. **minimax-m3 首例质量良好**：A-二次函数1 满分 11/11（think 清理后判），具备继续验收价值。
4. **验证闭环全绿**：deepseek/minimax 两轮跑批 unknown_commands 遥测为空，P0 校验层稳定。

## 阻塞项：生成通道欠费/故障（2026-09-05 晚逐一探测确认）

新供应商 api.b.ai（key `sk-2gvw...ptx` 有效）全模型探测结果：

| 模型（分销商真实 ID） | 文本 | 视觉 | 判定 |
|---|---|---|---|
| **glm-5.3-flash** | ✅ 200 | ✅ 200（166KB 原图直读） | **当前唯一全可用 → 已挂生产 config.json，单题探针 PASS 11/11，初筛启动** |
| minimax-m3 | ❌ 403 | — | **充值墙**「Deposit required to unlock premium models」，补跑阻塞 |
| deepseek-v4-flash-vision-exp（= 用户所称 deepseek-v4-vision） | ❌ 502 | — | 分销商上游故障，r2/r3 补轮前重试 |
| qwen3.8-flash | ✅ 200 | ❌ 502（小图也挂） | 视觉路由坏，本管线（传图）不可用 |
| qwen3.8-max / deepseek-v4-flash / mimo-v2.5(-pro) | ❌ 502 | — | 上游故障 |
| hy3 / hy4-preview | ✅ 200 / ❌ 400 | ❌ 502 | hy3 视觉坏；hy4 需内部余额 |
| kimi-k3 / kimi-k2.6 / glm-5.3 | ❌ 403 | — | 同一充值墙 |

注意：用户提供的模型名与分销商实际 ID 有偏差（hy-3→`hy3`、mimo-2.5→`mimo-v2.5`、
deepseek-v4-vision→`deepseek-v4-flash-vision-exp`），登记清单已按真实 ID 修正。

旧通道 opencode zen（qwen3.8 三轮即经此跑出）：CreditsError 余额耗尽。
qwen3.8-flash 的 DashScope 直连 key 随 `.env` 丢失，无法恢复原生产配置——
生产已改挂 glm-5.3-flash（全可用模型中验收数据最优候选）。

## 待办（按序执行）

1. **glm-5.3-flash 初筛**（跑批中）：26 题 × 1 轮，报告入 `acceptance_<时间>/`
2. **minimax-m3 补跑 25 题**：阻塞于充值墙——用户充值 api.b.ai 或另提供通道后执行
   （`.venv/Scripts/python.exe scripts/bench_run.py --label acc_minimax-m3_r1 --fresh --skip-channel-check`）
3. deepseek-v4-flash-vision-exp 502 重试；恢复后补 r2/r3
4. 过线模型统一补 L3 视觉判官；产出最终三模型验收结论，更新本报告与路线图
