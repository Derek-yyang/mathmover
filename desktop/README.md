# MathMover 桌面壳（Electron）

把工作台打包成可双击的 Windows 应用。壳本身只负责三件事：按顺序拉起 daemon 与
Next standalone、开窗口加载 `/dashboard`、退出时收拾干净。

## 怎么跑

```powershell
cd desktop
npm install                 # electron + electron-builder（首次会下载 Electron 运行时）
npm run prepare:assets      # Next 生产构建 + daemon 预编译 + 收集资产（几分钟）
npx electron-builder --dir  # 产出 release/win-unpacked/MathMover.exe
```

开发迭代：

- `MATHMOVER_SKIP_NEXT=1 npm run prepare:assets` 跳过 Next 重建，只重打 daemon 与资产。
- `npm run dev` 用 `desktop/build/` 直接起 Electron（不打包）。
- `node scripts/verify.mjs`：启动 unpacked 应用，验证窗口、GeoGebra 实例与一次真实构造。
- `node scripts/verify-agent.mjs`：本地 OpenAI 兼容 mock + 两轮对话，验证随包 OpenCode
  与原生会话续接（第二轮请求里带着第一轮上下文）。

## 运行时布局

`prepare.mjs` 产出 `desktop/build/`，electron-builder 原样搬进 `resources/`：

| 目录 | 内容 | 为什么必须随包 |
|---|---|---|
| `next/` | Next standalone（`server.js`、`.next-desktop/static`、`public/`、`node_modules/`） | 生产服务；`public/vendor` 里有 GeoGebra |
| `app/` | `MATHMOVER_ROOT`：`ggb_commands.json`、`skills/`、daemon 预编译入口、dsh patch | agent/daemon 运行时读这些资产 |
| `node/` | Node 24 二进制 | daemon 用 `node:sqlite` + `.ts` 入口，Electron 自带的 Node 版本不保证 |
| `bin/` | 自带的 opencode 二进制 | 内置 Agent 零安装可用的前提 |

主进程（`src/main.cjs`）依次：

1. 确认 8787 空闲（渲染进程的 WebSocket 默认地址是构建期常量），挑一个空闲的 daemon HTTP 端口；
2. 用随包 Node 起 `app/packages/daemon/src/cli.mjs`，等 `/api/health`；
3. 用同一个 Node 起 `next/server.js`（端口动态），等首页 200；
4. 开 `BrowserWindow` 加载 `http://127.0.0.1:<port>/dashboard`。

日志写在 `%LOCALAPPDATA%\MathMover\logs\{daemon,next}.log`。退出时用 `taskkill /T /F`
结束整棵子进程树；单实例锁避免第二个实例再抢端口。

## 为什么 daemon 要预编译

`mcp-stdio` 的启动配置由 `ensureMcpConfig` 生成，参数写死为
`<root>/packages/daemon/src/mcp-stdio.ts`。打包时把 `cli.ts` / `mcp-stdio.ts` 用
esbuild 打成单文件 JS，仍然放在这个**路径形状**上（内容是 JS，Node 24 的类型剥离对纯 JS
是空操作），这样运行时代码一行不用改。`app/packages/daemon/package.json` 里声明
`"type": "module"`，避免 Node 先按 CJS 试解析再告警。

## 已知限制（MVP 范围）

- **只验证了 Windows x64**，且是 `--dir` 的 unpacked 产物；安装器（NSIS）、图标、签名、
  自动更新都还没配。
- **WebSocket 端口固定 8787**：页面的 `ws://127.0.0.1:8787` 是构建期常量，端口占用时会
  直接报错退出；动态化需要给渲染进程加一条运行时配置通道。daemon HTTP 与 Next 端口是动态的。
- 安装包体积目前约 **450 MB**（Next 186 + Node 88 + opencode 173 + Electron 运行时）。
  opencode 只打一份非 baseline；GeoGebra 仍是完整 vendor。
- 内置 Agent 之外的 Claude Code / Codex / dsh 仍要求用户自己安装；没装时只是选择器里不可用。
- 卸载/升级时的用户数据在 `%LOCALAPPDATA%\MathMover`，不随应用目录走。

## 验收记录（2026-10-21）

- `verify.mjs`：窗口加载 `/dashboard`，GeoGebra 实例创建，经 `__mmGgb` 下发
  `A/B/c` 三个对象成功，无脚本错误、无失败请求。
- `verify-agent.mjs`：本地 mock 端点收到两轮 `/v1/chat/completions`，第二轮请求体里
  带第一轮用户消息与助手回复——原生会话续接成立；密钥以 Bearer 头发出。
