Windows x64 与 macOS Apple 芯片安装包。

- Mac 新增 Sparkle 自动更新：后台下载并验证更新包，完成后可选择「重启更新」，或在退出时安装。
- 原生更新模块不可用时保留 DMG 手动下载入口。
- Windows 继续使用现有后台下载与重启安装更新。

- Windows：下载 `MathMover-Setup.exe`。
- macOS 12+ Apple 芯片：下载 `MathMover-mac-arm64.dmg`，打开后把 MathMover 拖到「应用程序」。Intel Mac 暂不支持。

Mac 版尚未经过 Developer ID 签名和 Apple 公证。首次打开如提示「Apple 无法验证」，请在确认安装包来自本仓库后，前往「系统设置 → 隐私与安全性 → 仍要打开」。[首次安装图文说明](https://github.com/Derek-yyang/mathmover/blob/master/docs/macos-install.md)。

**已安装 Mac 0.0.4 或更早版本的用户，需要手动安装一次本版，以启用后续自动更新。** 课件与设置会保留。

首次使用请在设置中连接自己的模型 API，或选择本机已安装并登录的 Agent。
