# 在线体验部署

本目录是独立的 Next.js 工作台入口，共用现有画板、聊天 UI、OpenCode 运行时、构造和自检内核。不会替换 Cloudflare 首页，也不改变本机 Web、Desktop、MCP 的入口。

Vercel 项目根目录：`math-mover-next/online`。

- 安装：`cd ../.. && npm ci --ignore-scripts && cd math-mover-next && npm ci --ignore-scripts`
- 构建：`cd .. && npm run ggb:install && node online/scripts/prepare.mjs && cd online && npx next build --webpack && cd .. && node online/scripts/prune-trace.mjs`
- 输出目录：Next.js 默认 `.next`
- Node.js：24.x；Fluid Compute；生成连接最长 300 秒。

在 Vercel 设置服务端环境变量（不使用 NEXT_PUBLIC 前缀）：

- `MATHMOVER_ONLINE_API_KEY`
- `MATHMOVER_ONLINE_BASE_URL`（含版本前缀，例如 `https://provider.example/v1`）
- `MATHMOVER_ONLINE_MODEL`
- `MATHMOVER_ONLINE_API_FORMAT`（`openai-chat` / `openai-responses` / `anthropic` / `gemini`）
- `BLOB_READ_WRITE_TOKEN`（仅用于一次生成期间的题图和画板截图）

服务端环境变量是体验版的默认模型。体验者也可以在输入框的模型菜单中选择“使用自己的模型”，临时填写 API 格式、API 地址、模型 ID 和 Key。自定义配置只存在 React 页面内存，不写 localStorage、课件、对话历史或服务端存储；刷新或关闭页面后清除。发送时自定义 Key 只随本次 WebSocket 请求进入对应函数进程，并在运行结束后随临时目录释放。

包含题图的请求会先经过本轮 loopback 模型代理：代理把题图和 Agent 截图临时上传到 Vercel Blob 的随机公网 URL，再转发给支持 `image_url` 的模型。运行结束、失败或取消时立即删除这些 Blob；另设置一天 TTL 作为异常退出的清理兜底。

OpenCode Console 的 `*-free` 模型是例外：免费层要求请求由 OpenCode 本身发出，因此当接口地址为 `opencode.ai` 时，在线版会跳过 loopback 图片代理，让 OpenCode 直接携带图片请求模型。其他供应商仍使用临时公网图片 URL 的代理路径。

内置 DeepSeek V4.1 Flash Free 固定使用 `low` 思考强度，不向用户提供档位选择。用户切换到自己的模型时使用该供应商自己的默认值，避免发送不支持的推理字段。

在线版的题图输入保持与本机一致：题图随首轮请求直接交给内置 Agent，由同一个 Agent 完成读题、计算并通过原有 MathMover MCP 执行构造。`online/` 的模型代理只负责把内联图片转成供应商可读取的临时公网 URL，不额外拆出题目预分析或构造规划步骤。

浏览器保存当前页面的课件、账本与聊天；没有 localStorage / 数据库课件记录。刷新后清空。每次生成单独建立 WebSocket，Agent 和 MCP 的临时工作稿在生成结束、取消或断线后清理；下一轮从页面提交的账本与对话重建。新连接不依赖上一次命中的函数实例。

`GET /api/run` 提供无密钥的就绪信息；WebSocket `probe` 只检验云端与页面画板的双向连接。生成必须有模型配置。不可将健康检查通过描述为真实模型生成通过。

本地 WebSocket 集成验证需使用 Vercel CLI 54.14.2 或更新版本的 `vercel dev`。普通 `next dev` 不提供该升级接口。
