# Agent 接入门槛：检测、安装引导与 BYOK

MathMover 的核心闭环靠驱动第三方 agent。历史上这要求用户先装好至少一个受支持的
CLI（Claude Code / Codex / dsh）；本组改动把这道门槛从三个方向拆软，架构不变
（仍是「接本机、免 API key」为主），只补边缘。

## 三档

1. **扩发现**（`packages/agent-runtime/src/resolve.ts`）：探测顺序为
   `*_BIN` 显式覆盖（CLAUDE_BIN / CODEX_BIN / DSH_BIN）→ PATH（含
   fallbackBins 分叉名）→ Codex 桌面 app bundle（macOS 专属，`Codex.app/
   Contents/Resources/codex`）。显式覆盖**不做 PATH 回退**：指错了如实不可用，
   不静默换二进制（「绝不自动降级」裁决的延伸）。
2. **安装向导**（设置 → 课件生成 Agent）：「可安装」分组列出未检测到的 agent，
   安装 / 配置文档双链接 + 四步引导（装 CLI → 登录 → 刷新检测 → 选中）；
   附 PATH 排错与 `*_BIN` 提示。链接只打开官方页面，不代装。
3. **BYOK 内置构造通路**：不装任何 CLI 也能跑构造。自带 OpenAI 兼容端点 +
   密钥 + 模型（设置里配置），agent 内核是本服务的工具调用循环
   （`packages/agent-runtime/src/byok.ts`，对齐 OpenDesign 的 byok-tools 模式），
   ggb_* 真工具经 mcp-stdio 拿（schema 走 tools/list、执行走 tools/call，
   语义与真实 agent 完全一致）。

## BYOK 的边界（产品裁决，2026-10-13 对齐 OpenDesign 修订）

- **密钥保管（桌面化形态）**：key 存应用数据目录 `byok.json`，由本机应用保管——
  与 codex 配置在 cc-switch、claude 配置在 settings.json 同构（内置 agent 的
  「agent 配置」进应用自己的配置存储）。界面只回显 `apiKeyConfigured` + 尾 4 位
  （`•••• abcd`），**完整 key 永不回传浏览器**；请求体也不再携带 key。
  保存三态：非空覆盖 / 空串或不传保留 / null 清除。课件备份只打包数据库及其
  引用资源（courseware-store.createBackup），byok.json 天然不在备份包里。
- **流式**（对齐 OpenDesign 的 SSE BYOK）：请求 `stream:true`，正文按 delta 逐块
  转 text-delta 事件、tool_call 增量片段拼装；端点不支持流式时回落非流式 JSON。
- **轮次上限 3**（其 MAX_BYOK_TOOL_LOOPS=3）：超限**优雅收尾**——已吐正文保留、
  不发 error（他们的原话：close the stream gracefully）。
- **图片输入不支持**（OpenDesign 同样未做；其 BYOK 工具是输出向的媒体生成）。
  未配置端点/模型时如实 400 拒发。
- **模型清单**：BYOK 的「agent 配置」就是设置表单——与「清单以 agent 配置为
  唯一真相、不留手填入口」的裁决同构。

## 验证

- 单元（vitest）：`*_BIN` 覆盖优先/坏覆盖不回退/键名映射；BYOK 工具循环
  （SSE 流式与 tool_call 增量拼装、非流式回落、tool_calls 循环、回喂、
  HTTP 错误、轮次用尽优雅收尾、cancel、非法端点）；配置仓三态与掩码
  （byok-store.test.mjs）。
- 浏览器/API 验收：`node scripts/verify-byok-flow.mjs`——掩码 GET、设置表单
  保存（尾 4 位回显、key 本体不出仓）、选择器切换，完整 BYOK 循环直打
  /api/agent（SSE 事件流、mcp-stdio 工具闭环 8 工具、结果回喂、未配置 400），
  结束还原配置。工具只用只读 ggb_get_state，不写画布、不写课件库、不调真实模型。
- UI 发送路径的画布前置（未连接画板拒发 503）是既有正确行为；headless 页
  画布不连 daemon，故验收在 API 段覆盖循环、浏览器段覆盖表单。
