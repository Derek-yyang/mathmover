# MathMover MCP 版

独立的产品入口。宿主 Agent（例如 WorkBuddy）负责对话、题图理解和文件编辑，MathMover 提供本地工作稿、数学知识、GeoGebra 构造执行、自检和交互画板。支持 MCP Apps 的宿主会把画板直接显示在右侧面板中，不再占用浏览器标签栏和地址栏。

WorkBuddy 专家版位于仓库的 `workbuddy-expert/`。当前公开分发入口使用 npm 包 `@derekk/mathmover-mcp`，便于宿主独立安装、升级和生成 MCP 配置。

## npm 安装

推荐使用全局安装，再把 MCP 写入 WorkBuddy：

```powershell
npm install -g @derekk/mathmover-mcp
mathmover-mcp setup-workbuddy
```

`setup-workbuddy` 会合并写入 `~/.workbuddy/mcp.json`，只替换其中的 `mathmover` 项，并在修改前备份原文件。写入后完全退出并重新打开 WorkBuddy。

其他 MCP 宿主可以先输出完整配置：

```powershell
mathmover-mcp --print-config
```

`--print-config` 会输出当前机器可直接使用的 MCP JSON，其中的 Node 和入口路径均为绝对路径。部分 npm 12 环境没有把临时包的可执行文件加入 Windows PATH，请优先使用上面的全局安装方式。

## 使用流程

1. 在宿主添加 MathMover 本地 MCP 服务。
2. Agent 调用 `mathmover_open_canvas`，获得会话 ID、工作稿绝对路径和画板链接。
3. WorkBuddy 等 MCP Apps 宿主会直接打开 MathMover 面板。其他宿主可使用内置浏览器打开返回的链接作为回退。
4. Agent 使用自己的 Read/Edit/Write 能力编辑该会话的 `construction.ggb.txt`。
5. Agent 调用带有 `session_id` 的 `ggb_apply`，检查回执、截图与行级/语义检查结果，集中修改工作稿后再次应用。
6. 用户在 Agent 中继续提出调整，也可以在画板上操作动点、切换视图、保存和导出。

导出支持 GeoGebra 文件、交互 HTML 和 PNG 图片。在 MCP Apps 面板中，文件通过宿主的 `ui/download-file` 接口保存；在独立浏览器中使用浏览器下载。导出前会检查面板版本，旧面板在两秒后提示重新打开，不再长时间等待。面板资源地址随内容版本变化，避免宿主复用旧缓存。宿主不支持下载、取消保存或保存失败时，画板会显示提示，不会把发起下载误报为保存成功。更新 MCP 程序后，请重新启用 MCP 并重新打开画板，让宿主加载新版面板。

每段新对话创建独立画板。恢复课件时，使用原来的 `session_id` 调用 `mathmover_open_canvas`。`mathmover_list_canvases` 提供已保存课件的 ID 和名称。

## 跨任务生命周期

MathMover 在第一次使用时会启动一个独立的本地画板服务。MCP 的 stdio 连接只服务当前宿主任务，画板 HTTP、WebSocket、GeoGebra 状态和自动保存由本地服务托管。

因此宿主任务结束后，只要浏览器里的画板标签页还在，用户仍可以拖动动点、保存和导出。下一次在 WorkBuddy 开始新任务时，同一个数据目录会复用原服务；传入原 `session_id` 即可接回原画板并继续修改。

同一画板被宿主再次打开时，连接交给新页面；旧页面停止自动重连和自动保存，并提示“在此继续”。点击该按钮会先重新加载已保存的画板，再接回连接，避免两个页面反复争抢或写回旧状态。真正的网络断开仍会自动重试。`connected` 是打开工具调用当时的状态，不能用首次创建时的 `false` 判断最终面板是否打开；构造工具成功后，不应再通过 `present_files` 重复展示 URL。

需要手动停止常驻服务时运行：

```powershell
mathmover-mcp --shutdown-daemon
```

## 在当前仓库构建

需要 Node.js 22 或更高版本，以及仓库根目录和 `math-mover-next` 已安装的开发依赖、本地 GeoGebra 运行库。构建读取现有核心模块和画板组件，在本目录生成独立产物。

```powershell
cd mcp
npm run build
node dist/cli.cjs --print-config
```

`--print-config` 输出当前机器可直接使用的 MCP JSON，包含真实 Node 路径和编译后的入口路径。将输出添加到 WorkBuddy 的 MCP 配置中。插件名为 `mathmover`。

通用配置的形状如下，路径应使用命令实际输出的值。

```json
{
  "mcpServers": {
    "mathmover": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/mcp/dist/cli.cjs"]
    }
  }
}
```

WorkBuddy 会通过 MCP Apps 直接显示画板。宿主至少需要允许 Agent 访问工具返回的工作稿目录；不支持 MCP Apps 的客户端再回退到内置浏览器。首次可以输入“使用 MathMover 创建一个椭圆和动点”。

## npm 发布与本地打包

```powershell
npm pack --dry-run
npm publish --access public
```

编译后的服务端代码、浏览器代码、GeoGebra 资源、数学知识和第三方许可均包含在包内。运行包需要 Node.js 22 或更高版本，不需要仓库中的开发依赖。公开发布前必须提升 `package.json` 中的版本号。

## WorkBuddy 专家版

```powershell
cd mcp
npm run build:expert
npm run install:expert
npm run verify:expert
```

`build:expert` 生成完整的 `.expert-output/mathmover-builder/` 和可导入 ZIP；`install:expert` 将专家安装到当前用户的 WorkBuddy `my-experts` marketplace。公开分发的专家包只包含 Agent、Skill、头像和清单，不包含 `.mcp.json`、MCP 运行时或 Node。用户通过 npm 独立安装 MathMover，再由 `setup-workbuddy` 写入宿主配置，避免专家、Web 和 Desktop 各自携带一套内核。

专家首次使用时，Agent 会通过 WorkBuddy 的终端工具运行 Skill 内置的自动安装脚本。脚本优先复用 WorkBuddy 自带 Node，校验并下载 MathMover 包，然后自动写入 MCP 配置；用户只需批准终端权限并重启 WorkBuddy 一次。需要通过 npm 手动安装时，仍可使用上面的开发安装流程。

## 工具与工作稿

| 工具 | 用途 |
| --- | --- |
| `mathmover_open_canvas` | 创建或恢复画板，在支持 MCP Apps 的宿主中打开面板，并返回 URL、`session_id`、工作稿路径和完整构造规范 |
| `mathmover_list_canvases` | 按用户要求查找已保存课件 |
| `ggb_get_state` | 读取指定会话的对象、滑块、检查结果和截图 |
| `ggb_apply` | 读取指定会话的本地工作稿，执行构造并返回检查回执 |
| `ggb_reset` | 显式清空指定会话的画板与工作稿 |
| `get_expert_prompt` | 题图建模流程及分类 SOP，与现有核心共用 |
| `get_sop_cards` | 按需补充通用写法卡 |

`ggb_apply` 的输入不接受构造指令数组。原生文件编辑是唯一的构造写入流程。三个画板操作工具均要求显式传入 `session_id`，避免共享 MCP 进程操作到另一段对话的画板。底层直接复用原有工具注册与检查逻辑。

## 数据、保存与恢复

画板左上角的“课件”按钮可打开本地列表，支持搜索、切换、新建、重命名和删除。侧栏默认收起；切换或新建之前会先保存当前画板。删除需要确认，文件会移到 MCP 数据目录的 `trash` 中保留，不会直接销毁。这个列表只管理 MCP 版自己的数据，与 Web 和 Desktop 独立。

在提供 `ui/update-model-context` 能力的 MCP Apps 宿主中，切换课件会同步当前会话 ID 和工作稿路径，供 Agent 下一轮使用；普通浏览器或不支持该能力的宿主需由用户告知 Agent 要继续哪一份课件。宿主已有的产物卡片仍对应创建时的原课件。

默认数据目录分别为 Windows 的 `%LOCALAPPDATA%\MathMoverMCP`、macOS 的 `~/Library/Application Support/MathMoverMCP`、Linux 的 `$XDG_DATA_HOME/MathMoverMCP`（缺省为 `~/.local/share/MathMoverMCP`）。可用 `--data-dir <目录>` 或 `MATHMOVER_MCP_DATA_DIR` 指定独立目录。

每个会话包含 `session.json`、`construction.ggb.txt`、最后应用的 `applied.json` 和带对应构造清单的 `snapshot.json`。画板应用构造或交互后会自动保存，无需手动操作。恢复时仅使用与构造清单对应的完整快照，随后可继续操作动点。若快照尚未保存，则重放最后一次应用的构造。

本地服务使用系统分配的空闲回环端口。MCP App 面板只在内部加载画板 iframe，不显示浏览器地址栏。画板 HTTP 和 WebSocket 通道按会话检查凭证，访问令牌会随会话持久化。关闭面板或回退浏览器后，工作稿仍保存在磁盘；再次调用 `mathmover_open_canvas` 可恢复。

数据目录、启动命令、构建目录和版本在本产品中单独管理。源码复用通过只读导入完成。

## 验证

```powershell
npm run typecheck
npm test
npm run verify
npm run verify:package
```

`test` 覆盖 stdio 启动、工作稿约定、MCP App 资源、会话隔离、访问控制、断线保稿和跨 MCP 任务复用。`verify` 使用已安装的 Edge 和真实 GeoGebra，通过标准 MCP 客户端走 MCP App 内嵌画板、文件编辑、2D/3D 构造、状态/截图、自检、保存、刷新，以及任务结束后继续拖动和保存。`verify:package` 在 `npm pack` 后运行，将分发包解压到仓库外的临时目录，验证独立启动、资源和专家知识。验证使用专用临时数据目录，截图写入本目录下的 `.test-output`。

GeoGebra 运行库和字体的许可文件随原始资源分发，相关说明见 `THIRD_PARTY_NOTICES.md` 与运行库内的许可文件。
