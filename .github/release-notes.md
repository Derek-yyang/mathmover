Windows x64 与 macOS Apple 芯片安装包。

- 内置 Agent 使用 MathMover 独立的配置、会话、缓存与运行目录，避免读取本机 OpenCode 的配置、插件和技能。
- 禁用 OpenCode 重复的自动标题请求，避免所选模型正确时，附加请求仍因错误模型名而失败。
- 升级后按课件恢复原生 Agent 会话；可迁移的旧会话仅迁移对应课件的数据，找不到原生会话时从已保存的聊天历史恢复上下文。
- Windows 与 Mac 自动更新通过 MathMover 官网中转下载，并保留安装包完整性校验；Mac 同时验证 Sparkle 更新签名。

升级会保留课件与模型配置。模型 API 密钥无效、权限或余额不足等上游问题仍需在服务商处处理。

- Windows：下载 `MathMover-Setup.exe`。
- macOS 12+ Apple 芯片：下载 `MathMover-mac-arm64.dmg`，打开后把 MathMover 拖到「应用程序」。Intel Mac 暂不支持。

Mac 版尚未经过 Developer ID 签名和 Apple 公证。首次打开如提示「Apple 无法验证」，请在确认安装包来自本仓库后，前往「系统设置 → 隐私与安全性 → 仍要打开」。[首次安装图文说明](https://github.com/Derek-yyang/mathmover/blob/master/docs/macos-install.md)。

**已安装 Mac 0.0.4 或更早版本的用户，需要手动安装一次本版，以启用后续自动更新。** 课件与设置会保留。

首次使用请在设置中连接自己的模型 API，或选择本机已安装并登录的 Agent。
