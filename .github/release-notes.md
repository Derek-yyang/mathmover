Windows x64 与 macOS Apple 芯片安装包。

- 新增 Mac 正式下载入口与新版提醒，Mac 用户可免费下载安装。
- 修复首次保存模型 API 配置后仍显示「当前 Agent 尚未登录」的问题。
- Windows 桌面快捷方式的悬停说明改为产品介绍。

- Windows：下载 `MathMover-Setup.exe`。
- Mac（M1 / M2 / M3 / M4 及后续 Apple 芯片）：下载 `MathMover-mac-arm64.dmg`，打开后把 MathMover 拖到「应用程序」。Intel Mac 暂不支持。

Mac 版尚未经过 Developer ID 签名和 Apple 公证。首次打开如提示「Apple 无法验证」，请在确认安装包来自本仓库后，前往「系统设置 → 隐私与安全性 → 仍要打开」。[首次安装图文说明](https://github.com/Derek-yyang/mathmover/blob/master/docs/macos-install.md)。

Mac 版会检查新版并提供下载入口；退出应用后用新版替换旧版，课件和设置会保留。Windows 版继续使用后台下载与重启安装更新。

首次使用请在设置中连接自己的模型 API，或选择本机已安装并登录的 Agent。
