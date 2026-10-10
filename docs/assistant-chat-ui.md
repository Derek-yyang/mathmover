# 右侧聊天区：assistant-ui 接入

## 边界

- `useExternalStoreRuntime` 只投影宿主 `AgentChatMessage[]`；dashboard 仍负责 Agent 的 NDJSON 流、会话、画板和课件保存。
- 没有使用 assistant-cloud，也没有将工具重新注册为前端执行器。安装包的间接依赖不代表启用了云服务。
- 维持三栏布局、原有 Agent 选择和 GeoGebra 实例；不开放分支、编辑历史、重新生成或停止任务。
- `conversationId` 将输入草稿限定在当前课件；课件切换时重建聊天运行时，消息真源仍在宿主。

## 展示与输入

- 助手正文使用 Markdown、GFM 表格和 KaTeX，支持美元及转义括号数学分隔符；代码、宽表格和块公式在本区域内滚动。
- HTML 不执行，Markdown 远程图片不自动加载；题目附件通过原有图片预览展示。
- 图片本地读取为 data URL，沿用现有附件格式；上限 4 张、每张 6 MiB，PNG/JPEG/WebP/GIF。仅上传图片时补充默认题目指令，兼容当前接口的非空文本要求。
- 切换到不支持图片的 Agent 后，保留可移除附件并阻止发送，不静默丢图。
- 禁止发送与任务运行是两种状态：保存冲突时仍可编辑输入，不假装 Agent 正在生成。
- 工具步骤默认收起，仅展示实际活动元数据；“已返回”不等于构造检查通过。

## 检查

```powershell
cd D:\Mathmover\math-mover-next
npx tsc --noEmit
node --test tests/assistant-chat-adapter.test.mjs tests/agent-progress.test.mjs
npm run build
```

浏览器使用隔离课件和模拟 Agent 接口，已检查公式、消息恢复、发送、上传/粘贴/拖入/移除、类型及大小/数量校验、Agent 图片能力、步骤折叠、窄区溢出和保存冲突。未调用真实收费模型，未修改实际课件库。

生产构建通过；最终静态检查无错误。本地附件采用原生 img，存在两项 Next 图片优化建议。依赖审计仍报告既有 Next 等框架依赖问题，需独立升级评估，不能据此宣称达到发布安全标准。
