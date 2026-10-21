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

1. 给 daemon 的 WebSocket、daemon HTTP、Next 各挑一个空闲端口；
2. 用随包 Node 起 `app/packages/daemon/src/cli.mjs`，等 `/api/health`；
3. 用同一个 Node 起 `next/server.js`（端口动态），等首页 200；
4. 开 `BrowserWindow` 加载 `http://127.0.0.1:<port>/dashboard`。

WebSocket 地址由 Next 服务端在每请求时按 `MATHMOVER_WS_URL` 注入
（`app/dashboard/page.tsx` 是动态服务端组件），所以三个端口都可以动态挑。

首次启动且数据目录里还没有 `byok.json` 时，窗口会带 `?onboarding=1` 打开，工作台
自动弹出设置弹窗——普通用户需要先填端点/模型。只弹一次（数据目录落一个
`.desktop-onboarded` 标记）。

菜单：`MathMover → 打开日志目录 / 复制诊断信息`，`帮助 → 关于`（含版本、端口、路径）；
启动失败的错误框也带「打开日志目录」按钮。

日志写在 `%LOCALAPPDATA%\MathMover\logs\{daemon,next}.log`。退出时用 `taskkill /T /F`
结束整棵子进程树；单实例锁避免第二个实例再抢端口。

## 为什么 daemon 要预编译

`mcp-stdio` 的启动配置由 `ensureMcpConfig` 生成，参数写死为
`<root>/packages/daemon/src/mcp-stdio.ts`。打包时把 `cli.ts` / `mcp-stdio.ts` 用
esbuild 打成单文件 JS，仍然放在这个**路径形状**上（内容是 JS，Node 24 的类型剥离对纯 JS
是空操作），这样运行时代码一行不用改。`app/packages/daemon/package.json` 里声明
`"type": "module"`，避免 Node 先按 CJS 试解析再告警。

## 已知限制（MVP 范围）

- **只验证了 Windows x64**；安装器（NSIS）能出包，但图标外的签名、自动更新还没配。
- **三个端口都是动态的**；页面的 WebSocket 地址经运行时 env 注入，不再依赖构建期常量。
- 安装包体积目前约 **450 MB**（Next 186 + Node 88 + opencode 173 + Electron 运行时）。
  opencode 只打一份非 baseline；GeoGebra 仍是完整 vendor。
- 内置 Agent 之外的 Claude Code / Codex / dsh 仍要求用户自己安装；没装时只是选择器里不可用。
- 卸载/升级时的用户数据在 `%LOCALAPPDATA%\MathMover`，不随应用目录走。

## 验收记录（2026-10-21）

- `verify.mjs`：先占住 8787，桌面壳自动改用 8788 的 WebSocket，仍能完成构造；
  全新数据目录下设置弹窗自动打开（首次启动引导），Esc 可关闭；窗口加载 `/dashboard`，
  经 `__mmGgb` 下发 `A/B/c` 三个对象成功，无脚本错误、无失败请求。
- `verify-agent.mjs`：本地 mock 端点收到两轮 `/v1/chat/completions`，第二轮请求体里
  带第一轮用户消息与助手回复——原生会话续接成立；密钥以 Bearer 头发出。
- NSIS 安装包产出 `MathMover Setup 0.1.0.exe`（191MB），安装/启动/卸载全流程实测通过；
  应用图标已替换默认 Electron 图标（`build-resources/icon.png`，`scripts/make-icon.mjs` 可重生成）。
