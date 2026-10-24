# MathMover 桌面壳（Electron）

把工作台打包成可双击的桌面应用。提供 Windows x64 与 macOS Apple 芯片安装包。壳本身只负责三件事：按顺序拉起 daemon 与
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

## macOS Apple 芯片版

公开安装包见 [GitHub Releases](https://github.com/Derek-yyang/mathmover/releases/latest)，首次安装与更新步骤见 [Mac 图文说明](../docs/macos-install.md)。

GitHub Actions 的 **Desktop Release → Run workflow**：`platform=release` 构建两平台并统一发布；
`platform=macos` 仅构建 Mac 验证包，上传 `mathmover-macos-arm64` artifact，保留 7 天，不修改 Releases。
推送 `v*` tag 会正式发布两平台，tag 必须与 `desktop/package.json` 的版本一致。

下载 artifact 并解压后，可打开 `.dmg`，把 MathMover 拖到「应用程序」。另附 `.zip` 供直接解压。
包名包含 `mac-arm64`；目前不支持 Intel Mac，也不宣称是 Universal 通用包。

在 Apple 芯片 Mac 上本地构建（先安装 Node 24 与三个目录的 npm 依赖，并运行 `npm run ggb:install`）：

```sh
node desktop/scripts/make-mac-icons.mjs
cd desktop
npm run prepare:assets
npm run prepare:updater
npx electron-builder --mac --arm64 --publish never
cd ..
node desktop/scripts/verify-mac-package.mjs
node desktop/scripts/verify.mjs desktop/release/mac-arm64/MathMover.app/Contents/MacOS/MathMover
node desktop/scripts/verify-agent.mjs desktop/release/mac-arm64/MathMover.app/Contents/MacOS/MathMover
```

- **原生构建**：Node 直接使用构建机的二进制，Next 含原生依赖，因此必须在 arm64 Mac 上构建；不能在 Windows 上只加一个 `--arm64`。
- **平台资源**：OpenCode 按系统与 CPU 同时筛选，复制后恢复执行权限；打包前执行 Node/OpenCode 版本探针。
- **系统适配**：macOS 标题栏避让红黄绿按钮；菜单栏使用黑色透明模板 M 图标，随系统深浅色变化；原生编辑菜单支持复制粘贴。
- **本机 Agent**：从 Finder 启动时读取登录 shell 的 PATH，并补充 Homebrew、`~/.local/bin` 等常见路径；随包 Node 优先用于 CLI 的脚本入口。
- **数据目录**：默认 `~/Library/Application Support/MathMover`；测试脚本使用临时目录，避免读取或覆盖真实配置。
- **签名与更新**：当前仅做 ad-hoc 本地签名，尚无 Developer ID 签名和 Apple 公证。下载后可能被 Gatekeeper 拦截；确认来源后可按 macOS「系统设置 → 隐私与安全性」的提示批准打开。不要关闭系统安全检查。
  0.0.5 起使用 Sparkle：启动 15 秒后检查正式更新，后台下载并验证签名，完成后提示重启；也可退出时安装。旧版需手动安装一次带 Sparkle 的新版。原生模块不可用时保留手动下载兜底。
- **自动验证范围**：检查 .app 二进制架构/权限/签名、DMG 完整性、工作台启动与 GeoGebra 真实构造、随包 OpenCode 的两轮 mock 对话。下载到另一台 Mac 后的首次安装仍需人工验收。

## 运行时布局（两平台共用）

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

日志写在 `%LOCALAPPDATA%\MathMover\logs\{daemon,next,updater}.log`。退出时用 `taskkill /T /F`
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

- 官网下载入口固定为 `releases/latest/download/MathMover-Setup.exe`（Windows）和
  `releases/latest/download/MathMover-mac-arm64.dmg`（Mac）。
  `Desktop Release` 工作流等待两平台构建与 Mac 验证通过后，统一上传到草稿，检查安装包完整性后才公开并标记 latest。
  后续无需修改官网下载链接。不会覆盖已经公开的版本，需先提高 `desktop/package.json` 及 lockfile 的版本。
- 发布源：`electron-builder.yml` 的 `publish`（GitHub Releases，仓库公开、客户端匿名可读）。
- Windows 行为：启动 15 秒后静默检查；有新版本就后台下载，标题栏 ⋯ 右侧出现进度环，
  下载完成后变成重启按钮，点开就地确认「立即重启 / 稍后」；选「稍后」会在下次正常退出时安装。
  下载中断时图标变成警示标记，点击重试；仅检查失败（如离线）不亮状态。菜单「检查更新…」仍可手动触发。
- Mac 行为：Sparkle 后台下载 ZIP，验证 Ed25519 签名与签名后的 appcast，同一枚状态环给出进度并变成重启按钮，不点则在退出时安装。断网时启动检查保持安静，手动检查失败可打开 Releases；原生模块不可用时退回 DMG 手动下载。只使用完整更新包，暂不生成差分。
- Mac 更新源固定为 `releases/latest/download/appcast-mac-arm64.xml`。每次正式发布都必须包含签名后的 feed 和对应版本 ZIP；仅发布 DMG 会破坏更新入口。工作流先在草稿上传所有文件，再一起公开。
- 更新模块的事件与原始报错写入 `logs/updater.log`（Windows `%LOCALAPPDATA%\MathMover\logs`，macOS `~/Library/Application Support/MathMover/logs`），包含检查触发方式、更新源、发现/下载/就绪/错误信息和错误码；超过 1 MB 轮转为 `updater.log.1`。从 Finder 启动时 stdout 无人接收，排查更新问题以这个文件为准。
- 更新私钥存放在 Actions secret `SPARKLE_ED_PRIVATE_KEY`，公钥在 `src/sparkle-config.json` 与 `electron-builder.yml`。签名脚本验证两者匹配，不把私钥写入产物。私钥的本地备份放在被 Git 忽略的 `.secrets/`，必须妥善备份；丢失后不能给已安装客户端签发可信更新。
- Mac 本地打包前运行 `npm run prepare:updater` 编译 Electron 原生桥接。`npm run pack` 和 `npm run dist` 会自动执行；直接调用 electron-builder 则需要先手动执行。
- `node desktop/scripts/verify-sparkle.mjs` 在原生 Mac 上创建隔离的两个 Electron 应用，验证被篡改的更新包遭到拒绝，再验证下载、安装、重启新版与数据保留。不使用发布私钥，不操作本机已安装的 MathMover。
- 发布：更新桌面版本并提交后，推送对应 `v*` tag，或在 Desktop Release 中手动选择 `release`。需要两平台统一上传固定名称副本，不能单独用 electron-builder publisher 发布：
  ```powershell
  # 先把 desktop/package.json 的 version 改成新版本
  npm run prepare:assets
  npx electron-builder --publish never    # 仅本地打包；正式发布使用 Actions
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

## Windows 分发注意（未签名）

Windows 版本目前**不做代码签名**。实际影响与应对：

- 用户第一次运行安装包时，Windows 会弹「Windows 已保护你的电脑 / 未知发布者」，
  需要点「更多信息 → 仍要运行」。这不是故障，是未签名应用的标准提示。
- 部分杀毒软件可能对未签名的新 exe 误报；首次发布前建议在干净机器上跑一遍
  VirusTotal 之类的基础检查，并在下载页写明绕过方式。
- 自动更新的**完整性**不受影响：`latest.yml` 里的 sha512 会校验下载文件，传输走 HTTPS；
  但**来源真实性**依赖 GitHub Releases 本身，没有签名做二次证明。
- 未签名状态下不要频繁改 `appId` / `productName` / 安装包文件名——SmartScreen 的
  信誉是按文件与发布者累积的，改名会让提示重新开始。

## 已知限制（MVP 范围）


- **Windows x64 与 macOS arm64** 均提供安装包。Windows 安装器（NSIS）与自动更新链路已实测；Mac 已通过原生构建、工作台及 Agent 自动验证，并完成用户实机测试。两平台尚无开发者身份签名；Intel Mac 暂未支持。
- **三个端口都是动态的**；页面的 WebSocket 地址经运行时 env 注入，不再依赖构建期常量。
- 安装包体积目前约 **450 MB**（Next 186 + Node 88 + opencode 173 + Electron 运行时）。
  opencode 只打一份非 baseline；GeoGebra 仍是完整 vendor。
- 内置 Agent 之外的 Claude Code / Codex / dsh 仍要求用户自己安装；没装时只是选择器里不可用。
- 卸载/升级时的用户数据在 `%LOCALAPPDATA%\MathMover`，不随应用目录走。

## macOS 测试包验收（2026-10-23）

- [原生 arm64 Actions 构建](https://github.com/Derek-yyang/mathmover/actions/runs/39825333867)通过，产出 `MathMover-0.0.3-mac-arm64.dmg` 和 `.zip`；测试 artifact 保留 7 天，可重新手动构建。
- 应用、随包 Node 和 OpenCode 均为 arm64；执行权限、包内依赖、本地签名、Dock 图标与 DMG 校验通过。
- 打包版完成 GeoGebra 的 A/B/c 构造；两轮 mock 模型对话保留上下文，无页面脚本错误；两条测试均确认应用正常退出。
- 托盘生命周期、平台资源选择与 Finder PATH 测试通过；Windows 打包版构造与两轮 mock 对话回归通过。
- 0.0.3 Mac 测试包已完成用户实机测试；真实模型服务与外部 CLI 的完整兼容性仍需继续验证。Developer ID 和 Apple 公证尚未配置。

## Windows 验收记录（2026-10-21）

- `verify.mjs`：先占住 8787，桌面壳自动改用 8788 的 WebSocket，仍能完成构造；
  全新数据目录下设置弹窗自动打开（首次启动引导），Esc 可关闭且重新加载不再弹出；
  窗口加载 `/dashboard`，应用内标题栏存在、菜单可开合，深色主题下标题栏变 `#181818`；
  经 `__mmGgb` 下发 `A/B/c` 三个对象成功，无脚本错误、无失败请求。
- `verify-agent.mjs`：本地 mock 端点收到两轮 `/v1/chat/completions`，第二轮请求体里
  带第一轮用户消息与助手回复——原生会话续接成立；密钥以 Bearer 头发出。
- NSIS 安装包产出 `MathMover Setup 0.1.0.exe`（191MB），安装/启动/卸载全流程实测通过；
  应用图标已替换默认 Electron 图标（`build-resources/icon.png`，`scripts/make-icon.mjs` 可重生成）。
