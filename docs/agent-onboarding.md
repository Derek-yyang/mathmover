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

## BYOK 的边界（产品裁决）

- **密钥保管**：key 只存浏览器 localStorage，随请求经回环传给本机服务，
  不落服务端磁盘、不进课件库。「密钥归配置」在内置通路上的对应形态。
- **v1 收敛**：非流式补全（正文按工具轮成块出现）、最多 16 轮工具往返、
  不递送图片（提示改用文字描述）。未配置端点/模型时如实 400 拒发。
- **模型清单**：BYOK 的「agent 配置」就是设置表单——与「清单以 agent 配置为
  唯一真相、不留手填入口」的裁决同构。

## 验证

- 单元（vitest）：`*_BIN` 覆盖优先/坏覆盖不回退/键名映射；BYOK 工具循环
  （tool_calls 循环、回喂、HTTP 错误、轮次上限、cancel、非法端点）。
- 浏览器/API 验收：`node scripts/verify-byok-flow.mjs`——设置表单保存与
  选择器切换（浏览器段），完整 BYOK 循环直打 /api/agent（路由分支、mcp-stdio
  工具闭环 8 工具、NDJSON 事件流、未配置 400）。工具只用只读 ggb_get_state，
  不写画布、不写课件库、不调真实模型。
- UI 发送路径的画布前置（未连接画板拒发 503）是既有正确行为；headless 页
  画布不连 daemon，故验收在 API 段覆盖循环、浏览器段覆盖表单。
