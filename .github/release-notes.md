Windows x64 与 macOS Apple 芯片安装包。

- 窗口标题栏新增更新状态环：发现新版本后显示下载进度，下载完成变成重启按钮，点开就地确认「立即重启 / 稍后」；下载失败可点击重试。不再弹出系统对话框打断正在进行的生成。
- 打开设置等弹窗时，Windows 原生窗口按钮区域会随遮罩一起变暗，不再出现颜色断层。
- 不点重启也没关系：选择稍后，更新会在退出应用时自动安装。课件与设置会保留。
- 桌面应用不再打开项目首页，统一进入工作台。
- 官网首页的 Mac 安装说明改为链接到单独的文档页。

- Windows：下载 `MathMover-Setup.exe`。
- macOS 12+ Apple 芯片：下载 `MathMover-mac-arm64.dmg`，打开后把 MathMover 拖到「应用程序」。Intel Mac 暂不支持。

Mac 版尚未经过 Developer ID 签名和 Apple 公证。首次打开如提示「Apple 无法验证」，请在确认安装包来自本仓库后，前往「系统设置 → 隐私与安全性 → 仍要打开」。[首次安装图文说明](https://github.com/Derek-yyang/mathmover/blob/master/docs/macos-install.md)。

**已安装 Mac 0.0.4 或更早版本的用户，需要手动安装一次本版，以启用后续自动更新。** 课件与设置会保留。

首次使用请在设置中连接自己的模型 API，或选择本机已安装并登录的 Agent。
