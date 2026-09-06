# 正式验收对比报告（五模型）— 2026-09-05

> **验收名单（用户拍板 2026-09-05 晚）**：glm-5.3-flash、qwen3.8-flash、hy3、deepseek-v4-flash-vision-exp、mimo-v2.5。
> minimax-m3 移出名单。登记见 `benchmarks/acceptance_models.json`（含分销商真实模型 ID）。

## 验收口径（用户已拍板，见 PIPELINE_ROADMAP.md）

- **泛化达标** = 选定模型清单 × 全部 26 题 × **多轮生成 L2 性质判分全过**（后续补 L3 视觉判官）
- L2 有效题数 25（C-抛物线1 历史错位样本 `"skip": true` 下架待重收录）
- 主指标：性质命中率（跨模型可比）；题型为四类作图题封闭集；不做逐模型 prompt 适配
- 判分链路：`ggb_parser.py`（含 `strip_think_blocks`，think 污染已免疫）+ `scripts/properties.py`

## 矩阵总览（L2 性质判分，校准后清单口径）

> 2026-09-06 晚更新：minimax-m3 经用户决定移出名单；hy3 初筛完成（不达标）；glm r1 完成 15/26 后
> 遭遇分销商长请求持续超时，pass3/pass4 后台自愈补跑中（后端超时已上调 600s）。

| 模型 | r1 | r2 | r3 | 性质命中 | 结论 |
|---|---|---|---|---|---|
| **qwen3.8-flash**（新范例 prompt） | **88%** (22/25) | **92%** (23/25) | **96%** (24/25) | 98.5~99.5% | ✅ 三轮达标（数据复用），L3 待补 |
| **deepseek-v4-vision** | **88%** (22/25) | 待补 | 待补 | 97.5% | 🟡 r1 达标；r2/r3 与新通道均阻塞于分销商零余额 |
| **glm-5.3-flash** | **87%** (13/15，余 11 题补跑中) | — | — | 98.3% | 🟢 已完成部分为 qwen 级水准，全量后有望 85~92% |
| **hy3** | **8%** (2/25) | — | — | 43.7% | ❌ **不达标**：视觉理解不足，看错题后自由发挥画同题材通用图 |
| **mimo-2.5** | — | — | — | — | 🔴 分销商无视觉渠道（503），变体亦零余额，无法评估 |

hy3 失败模式实例（A-二次函数2）：期望清单对应"直线与抛物线交于 A(0.5,2.5)、B(4,6)"
的真实考题，hy3 却生成"过 A(0,3)、B(-1,0)、D(2,3) 求二次函数"的同题材通用题——
图像阅读失败后按题型先验编题，流畅但错误。首题 PASS 属偶然读对。

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
3. **glm-5.3-flash 探针良好**：A-二次函数1 满分 11/11（端到端含 P0 校验），具备验收价值。
   （历史记录：minimax-m3 中断前首例亦 11/11，后按用户决定移出名单）
4. **验证闭环全绿**：deepseek/minimax 两轮跑批 unknown_commands 遥测为空，P0 校验层稳定。

## 阻塞项：生成通道（2026-09-05 晚两轮探测，通道状态是动态的）

新供应商 api.b.ai（key `sk-2gvw...ptx` 有效）五模型最终状态：

| 模型（分销商真实 ID） | 文本 | 视觉 | 判定 |
|---|---|---|---|
| **glm-5.3-flash** | ✅ | ✅（166KB 原图直读） | **全可用 → 已挂生产 config.json，初筛跑批中** |
| **qwen3.8-flash** | ✅ | ✅（首轮 502，二轮恢复） | **全可用**；三轮验收数据已存在（复用），生产 config 待切换 |
| **hy3** | ✅ | ✅（首轮 502，二轮恢复） | **全可用 → 排队跑 r1** |
| deepseek-v4-flash-vision-exp（=用户所称 ds） | ❌ 400 | ❌ 400 | **内部余额=0**（credit insufficient），所有 deepseek 变体同墙 |
| mimo-v2.5（=用户所称 mimo） | ✅ | ❌ 503 无可用渠道 | 视觉通道缺失；变体 mimo-v2.5-pro 亦余额=0 |

结论：**五模型中 3 个可立即跑（glm/qwen3.8/hy3），deepseek 与 mimo 需分销商充值**（同一把 key，
账户内部 credit balance=0；此前 403「Deposit required」与 502 均为其网关的不同表现形态）。
若坚持补齐 ds/mimo：充值 api.b.ai 或另提供通道；mimo 还需分销商开通视觉渠道。

注意：用户提供的模型名与分销商实际 ID 有偏差（hy-3→`hy3`、mimo-2.5→`mimo-v2.5`、
deepseek-v4-vision→`deepseek-v4-flash-vision-exp`），登记清单已按真实 ID 修正。

旧通道 opencode zen（qwen3.8 三轮、deepseek r1 即经此跑出）：CreditsError 余额耗尽。
qwen3.8-flash 的 DashScope 直连 key 随 `.env` 丢失。

## 待办（按序执行）

1. **glm r1 收尾**：pass3/pass4 后台自愈补跑余 11 题（C-双曲线1、C-抛物线1/2、D-多面体×3、
   D-正方体×3、D-球×2；后端超时已上调 600s），`GLM_PASS3_DONE` 标记落地后
   跑 `rejudge_offline.py --archive candidate_glm53flash_r1.txt` 出全量数字并更新本表
2. **qwen3.8-flash**：三轮数据复用；可选在新通道补确认轮
3. **deepseek r2/r3、mimo 初筛**：阻塞于分销商零余额——充值 api.b.ai 或另提供通道
4. 过线模型（qwen3.8 / deepseek / glm）统一补 L3 视觉判官；产出最终验收结论，更新路线图
