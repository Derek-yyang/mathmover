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
- `node scripts/verify-tray.cjs`：用真实 Electron 验证关闭、托盘恢复、设置持久化、
  图标加载失败回退和完全退出；数据使用独立临时目录。

## 安装形态

`npx electron-builder` 产出辅助安装器（NSIS）：

- 默认按当前用户安装到 `%LOCALAPPDATA%\Programs\MathMover`，不需要管理员权限；
- 安装向导里可以自选安装目录（`allowToChangeInstallationDirectory`）；
- 创建开始菜单快捷方式；桌面快捷方式可在安装选项页选择，默认勾选；
- 静默安装与自动更新跳过安装选项页，自动更新保留已有的桌面快捷方式状态；
- 安装器使用带下载标记的独立图标；修改 `build-resources/installerIcon.svg` 后，
  在 `desktop` 目录运行 `node scripts/make-installer-icon.mjs` 重新生成 PNG 和 ICO；
- 卸载不删除 `%LOCALAPPDATA%\MathMover` 里的用户数据；
- 自选目录请确保可写。应用运行时不写安装目录：MCP 配置与 dsh patch 会落到
  `%LOCALAPPDATA%\MathMover\mcp`（`MATHMOVER_MCP_DIR`），日志与课件也都在数据目录。
- Electron 自己的 profile（localStorage、缓存、窗口状态）也收在
  `%LOCALAPPDATA%\MathMover\electron`，不再是 `%APPDATA%\mathmover-desktop`；
  首次升级会把旧目录整体迁移过去。因此本机所有数据都在 `%LOCALAPPDATA%\MathMover` 下。

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

**首个版本默认 BYOK**：内置 OpenCode 负责"零安装运行"，但模型端点与 key 由用户自备；
不提供免费代理/配额通道。设置弹窗里同时列出本机已装的 Claude Code / Codex / dsh 作为备选。

菜单：`MathMover → 打开日志目录 / 复制诊断信息`，`帮助 → 关于`（含版本、端口、路径）；
启动失败的错误框也带「打开日志目录」按钮。

## 窗口外观

系统标题栏已隐藏（`titleBarStyle: 'hidden'`），只保留系统绘制的窗口按钮
（`titleBarOverlay`）；应用内标题栏由 `app/layout.tsx` 渲染，显示品牌、版本与
「⋯」菜单（检查更新 / 日志 / 诊断 / 关于）。整条标题栏是窗口拖拽区，按钮区
`-webkit-app-region: no-drag`。

- 标题栏只在**桌面构建**里出现：`prepare.mjs` 在 `next build` 时注入
  `MATHMOVER_DESKTOP=1`，网页版（含 dev server）不受影响。
- 原生菜单栏默认隐藏（`autoHideMenuBar`），按 Alt 仍可唤出；常用动作在应用内菜单里。
- 深浅主题切换时，渲染进程通过 preload 的 `setTitleBarTheme` 通知主进程，
  原生按钮、窗口边框与标题栏颜色一起切换。
- `src/preload.cjs` 仅暴露桌面标识、菜单动作、标题栏主题与窗口设置；
  IPC 动作在主进程里按白名单处理，窗口设置请求仅接受主窗口的顶层页面。

日志写在 `%LOCALAPPDATA%\MathMover\logs\{daemon,next}.log`。退出时用 `taskkill /T /F`
结束整棵子进程树；单实例锁避免第二个实例再抢端口。

## 系统托盘

- 启动后显示绿色 M 托盘图标，单击或双击恢复窗口；右键提供「打开 MathMover」、
  「检查更新…」和「退出」。再次启动应用也会唤回已隐藏的窗口。
- 设置 → 外观 → 窗口行为中可开启「关闭窗口时收起到托盘」，默认关闭。
  开启后，关闭按钮只隐藏窗口，正在生成的任务继续运行；从托盘选择「退出」才完全退出。
- 偏好保存在 `%LOCALAPPDATA%\MathMover\desktop-settings.json`，重启后保留。
  托盘创建失败时不会拦截关闭窗口，避免应用留在后台却无法重新打开。
- 正常退出、自动更新重启以及 Windows 注销/关机时会清理托盘和后台服务。
- 托盘图标随包放在 `build-resources/icon.ico`；`node scripts/make-icon.mjs` 可重新生成。

## 为什么 daemon 要预编译

`mcp-stdio` 的启动配置由 `ensureMcpConfig` 生成，参数写死为
`<root>/packages/daemon/src/mcp-stdio.ts`。打包时把 `cli.ts` / `mcp-stdio.ts` 用
esbuild 打成单文件 JS，仍然放在这个**路径形状**上（内容是 JS，Node 24 的类型剥离对纯 JS
是空操作），这样运行时代码一行不用改。`app/packages/daemon/package.json` 里声明
`"type": "module"`，避免 Node 先按 CJS 试解析再告警。

## 自动更新

- 官网下载入口固定为
  `https://github.com/Derek-yyang/mathmover/releases/latest/download/MathMover-Setup.exe`。
  `Desktop Release` 工作流把版本化安装包复制为 `MathMover-Setup.exe` 一起发布，
  上传完成后将该版本标记为 latest。后续通过工作流发布新版本，无需修改首页或重新部署官网。
  手动发布时也需要上传这个固定名称副本；保留原版安装包、blockmap 和 latest.yml 供自动更新使用。
- 发布源：`electron-builder.yml` 的 `publish`（GitHub Releases，仓库公开、客户端匿名可读）。
- 行为：启动 15 秒后静默检查；有新版本就后台下载，下载完弹「立即重启 / 稍后」；
  选「稍后」会在下次正常退出时安装。菜单「检查更新…」可手动触发。
- 发布：
  ```powershell
  # 先把 desktop/package.json 的 version 改成新版本
  npm run prepare:assets
  npx electron-builder --publish always   # 需要 GH_TOKEN；自动上传 exe / blockmap / latest.yml
  ```
- 本地验证（不需要真实发布）：
  ```powershell
  # 1) 用当前版本打一个"旧版"，产物在 release/update-old
  npx electron-builder --publish never
  mkdir release/update-old
  copy release\MathMover-<旧版本>-Setup.exe release\update-old\
  copy release\MathMover-<旧版本>-Setup.exe.blockmap release\update-old\
  copy release\latest.yml release\update-old\

  # 2) 临时改版本号再打一个"新版"，产物放 release/update-new，然后改回版本号
  #    （脚本会从 package.json 读版本，建议先备份）

  # 3) 装旧版 → 本地源 → 自动升级 → 校验版本 → 卸载
  node desktop/scripts/verify-update.mjs --old desktop/release/update-old --feed desktop/release/update-new --expected <新版本>
  ```
  脚本会起一个支持 Range 的本地更新源；`MATHMOVER_UPDATE_URL` 让客户端改指向它，
  `MATHMOVER_UPDATE_AUTOINSTALL=1` 让下载完直接静默安装，便于无人值守验证。

## 分发注意（未签名）

本项目**不做代码签名**。实际影响与应对：

- 用户第一次运行安装包时，Windows 会弹「Windows 已保护你的电脑 / 未知发布者」，
  需要点「更多信息 → 仍要运行」。这不是故障，是未签名应用的标准提示。
- 部分杀毒软件可能对未签名的新 exe 误报；首次发布前建议在干净机器上跑一遍
  VirusTotal 之类的基础检查，并在下载页写明绕过方式。
- 自动更新的**完整性**不受影响：`latest.yml` 里的 sha512 会校验下载文件，传输走 HTTPS；
  但**来源真实性**依赖 GitHub Releases 本身，没有签名做二次证明。
- 未签名状态下不要频繁改 `appId` / `productName` / 安装包文件名——SmartScreen 的
  信誉是按文件与发布者累积的，改名会让提示重新开始。

## 已知限制（MVP 范围）


- **只验证了 Windows x64**；安装器（NSIS）与自动更新链路已实测。按项目决定**不做代码签名**，
  安装/更新时会有 SmartScreen 提示（见上一节）。
- **三个端口都是动态的**；页面的 WebSocket 地址经运行时 env 注入，不再依赖构建期常量。
- 安装包体积目前约 **450 MB**（Next 186 + Node 88 + opencode 173 + Electron 运行时）。
  opencode 只打一份非 baseline；GeoGebra 仍是完整 vendor。
- 内置 Agent 之外的 Claude Code / Codex / dsh 仍要求用户自己安装；没装时只是选择器里不可用。
- 卸载/升级时的用户数据在 `%LOCALAPPDATA%\MathMover`，不随应用目录走。

## 验收记录（2026-10-21）

- `verify.mjs`：先占住 8787，桌面壳自动改用 8788 的 WebSocket，仍能完成构造；
  全新数据目录下设置弹窗自动打开（首次启动引导），Esc 可关闭且重新加载不再弹出；
  窗口加载 `/dashboard`，应用内标题栏存在、菜单可开合，深色主题下标题栏变 `#181818`；
  经 `__mmGgb` 下发 `A/B/c` 三个对象成功，无脚本错误、无失败请求。
- `verify-agent.mjs`：本地 mock 端点收到两轮 `/v1/chat/completions`，第二轮请求体里
  带第一轮用户消息与助手回复——原生会话续接成立；密钥以 Bearer 头发出。
- NSIS 安装包产出 `MathMover Setup 0.1.0.exe`（191MB），安装/启动/卸载全流程实测通过；
  应用图标已替换默认 Electron 图标（`build-resources/icon.png`，`scripts/make-icon.mjs` 可重生成）。
